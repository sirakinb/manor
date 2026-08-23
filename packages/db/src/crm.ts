import type {
  Actor,
  CrmContact,
  CrmDeal,
  CrmOverview,
  CrmPipeline,
  CrmTag,
} from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

/**
 * CRM data access. Every function takes the actor and scopes by its
 * workspace; a row that belongs to someone else is treated as not existing
 * at all, the same rule the rest of the repos follow.
 */

/** The board a workspace starts with, so the pipeline is never an empty screen. */
const DEFAULT_PIPELINE = {
  name: "Sales",
  stages: ["Lead", "Qualified", "Proposal", "Negotiation", "Closed"],
};

type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  status: string;
  createdAt: Date;
  tags: { tag: { id: string; name: string; color: string | null } }[];
};

function mapContact(row: ContactRow): CrmContact {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    company: row.company,
    notes: row.notes,
    status: row.status === "archived" ? "archived" : "active",
    tags: row.tags.map((entry) => entry.tag),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapDeal(row: {
  id: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  title: string;
  value: number;
  status: string;
  createdAt: Date;
}): CrmDeal {
  return {
    id: row.id,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    contactId: row.contactId,
    title: row.title,
    value: row.value,
    status: row.status === "won" ? "won" : row.status === "lost" ? "lost" : "open",
    createdAt: row.createdAt.toISOString(),
  };
}

function mapPipeline(row: {
  id: string;
  name: string;
  position: number;
  stages: {
    id: string;
    pipelineId: string;
    name: string;
    position: number;
    color: string | null;
  }[];
}): CrmPipeline {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    stages: [...row.stages].sort((a, b) => a.position - b.position),
  };
}

const CONTACT_INCLUDE = { tags: { include: { tag: true } } } as const;

export function createCrmRepos(prisma: PrismaClient) {
  async function requireContact(actor: Actor, contactId: string) {
    const row = await prisma.crmContact.findUnique({ where: { id: contactId } });
    if (!row || row.workspaceId !== actor.workspaceId) throw new IsolationError();
    return row;
  }

  async function requireDeal(actor: Actor, dealId: string) {
    const row = await prisma.crmDeal.findUnique({ where: { id: dealId } });
    if (!row || row.workspaceId !== actor.workspaceId) throw new IsolationError();
    return row;
  }

  async function requirePipeline(actor: Actor, pipelineId: string) {
    const row = await prisma.crmPipeline.findUnique({
      where: { id: pipelineId },
      include: { stages: true },
    });
    if (!row || row.workspaceId !== actor.workspaceId) throw new IsolationError();
    return row;
  }

  async function overview(actor: Actor): Promise<CrmOverview> {
    const where = { workspaceId: actor.workspaceId };
    const [pipelines, deals, contacts, tags] = await Promise.all([
      prisma.crmPipeline.findMany({
        where,
        include: { stages: true },
        orderBy: { position: "asc" },
      }),
      prisma.crmDeal.findMany({ where, orderBy: { createdAt: "desc" } }),
      prisma.crmContact.findMany({
        where,
        include: CONTACT_INCLUDE,
        orderBy: { createdAt: "desc" },
      }),
      prisma.crmTag.findMany({ where, orderBy: { name: "asc" } }),
    ]);
    return {
      pipelines: pipelines.map(mapPipeline),
      deals: deals.map(mapDeal),
      contacts: contacts.map(mapContact),
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    };
  }

  return {
    overview,

    /**
     * Idempotent, and safe against itself: the first visit fires this from an
     * effect that React may run twice, so the check-then-create holds a
     * per-workspace advisory lock for the transaction.
     */
    async seedDefaultPipeline(actor: Actor): Promise<CrmOverview> {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm-seed-${actor.workspaceId}`}))`;
        const existing = await tx.crmPipeline.count({
          where: { workspaceId: actor.workspaceId },
        });
        if (existing > 0) return;
        await tx.crmPipeline.create({
          data: {
            workspaceId: actor.workspaceId,
            name: DEFAULT_PIPELINE.name,
            stages: {
              create: DEFAULT_PIPELINE.stages.map((name, position) => ({ name, position })),
            },
          },
        });
      });
      return overview(actor);
    },

    async createContact(
      actor: Actor,
      input: {
        firstName: string;
        lastName: string;
        email?: string;
        phone?: string;
        company?: string;
        notes?: string;
        tagIds?: string[];
      },
    ): Promise<CrmContact> {
      const tagIds = await ownedTagIds(prisma, actor, input.tagIds);
      const row = await prisma.crmContact.create({
        data: {
          workspaceId: actor.workspaceId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email || null,
          phone: input.phone || null,
          company: input.company || null,
          notes: input.notes || null,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        },
        include: CONTACT_INCLUDE,
      });
      return mapContact(row);
    },

    async updateContact(
      actor: Actor,
      input: {
        contactId: string;
        firstName?: string;
        lastName?: string;
        email?: string | null;
        phone?: string | null;
        company?: string | null;
        notes?: string | null;
        status?: "active" | "archived";
        tagIds?: string[];
      },
    ): Promise<CrmContact> {
      await requireContact(actor, input.contactId);
      const tagIds =
        input.tagIds === undefined ? undefined : await ownedTagIds(prisma, actor, input.tagIds);
      const row = await prisma.crmContact.update({
        where: { id: input.contactId },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          company: input.company,
          notes: input.notes,
          status: input.status,
          ...(tagIds === undefined
            ? {}
            : { tags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) } }),
        },
        include: CONTACT_INCLUDE,
      });
      return mapContact(row);
    },

    async deleteContact(actor: Actor, contactId: string): Promise<void> {
      await requireContact(actor, contactId);
      await prisma.crmContact.delete({ where: { id: contactId } });
    },

    async createTag(actor: Actor, input: { name: string; color?: string }): Promise<CrmTag> {
      const row = await prisma.crmTag.upsert({
        where: { workspaceId_name: { workspaceId: actor.workspaceId, name: input.name } },
        create: { workspaceId: actor.workspaceId, name: input.name, color: input.color ?? null },
        update: {},
      });
      return { id: row.id, name: row.name, color: row.color };
    },

    async createPipeline(
      actor: Actor,
      input: { name: string; stages: { name: string }[] },
    ): Promise<CrmPipeline> {
      const last = await prisma.crmPipeline.findFirst({
        where: { workspaceId: actor.workspaceId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const row = await prisma.crmPipeline.create({
        data: {
          workspaceId: actor.workspaceId,
          name: input.name,
          position: (last?.position ?? -1) + 1,
          stages: {
            create: input.stages.map((stage, position) => ({ name: stage.name, position })),
          },
        },
        include: { stages: true },
      });
      return mapPipeline(row);
    },

    async deletePipeline(actor: Actor, pipelineId: string): Promise<void> {
      await requirePipeline(actor, pipelineId);
      await prisma.crmPipeline.delete({ where: { id: pipelineId } });
    },

    async createDeal(
      actor: Actor,
      input: {
        pipelineId: string;
        stageId: string;
        title: string;
        value: number;
        contactId?: string;
      },
    ): Promise<CrmDeal> {
      const pipeline = await requirePipeline(actor, input.pipelineId);
      if (!pipeline.stages.some((stage) => stage.id === input.stageId)) {
        throw new IsolationError("Stage is not in this pipeline");
      }
      if (input.contactId) await requireContact(actor, input.contactId);
      const row = await prisma.crmDeal.create({
        data: {
          workspaceId: actor.workspaceId,
          pipelineId: input.pipelineId,
          stageId: input.stageId,
          title: input.title,
          value: input.value,
          contactId: input.contactId ?? null,
        },
      });
      return mapDeal(row);
    },

    async updateDeal(
      actor: Actor,
      input: {
        dealId: string;
        title?: string;
        value?: number;
        contactId?: string | null;
        status?: "open" | "won" | "lost";
      },
    ): Promise<CrmDeal> {
      await requireDeal(actor, input.dealId);
      if (input.contactId) await requireContact(actor, input.contactId);
      const row = await prisma.crmDeal.update({
        where: { id: input.dealId },
        data: {
          title: input.title,
          value: input.value,
          contactId: input.contactId,
          status: input.status,
        },
      });
      return mapDeal(row);
    },

    async moveDeal(actor: Actor, dealId: string, stageId: string): Promise<CrmDeal> {
      const deal = await requireDeal(actor, dealId);
      const pipeline = await requirePipeline(actor, deal.pipelineId);
      if (!pipeline.stages.some((stage) => stage.id === stageId)) {
        throw new IsolationError("Stage is not in this pipeline");
      }
      const row = await prisma.crmDeal.update({ where: { id: dealId }, data: { stageId } });
      return mapDeal(row);
    },

    async deleteDeal(actor: Actor, dealId: string): Promise<void> {
      await requireDeal(actor, dealId);
      await prisma.crmDeal.delete({ where: { id: dealId } });
    },
  };
}

/** Tag ids filtered to the actor's workspace; unknown ids are dropped, not errors. */
async function ownedTagIds(
  prisma: PrismaClient,
  actor: Actor,
  tagIds: string[] | undefined,
): Promise<string[]> {
  if (!tagIds?.length) return [];
  const rows = await prisma.crmTag.findMany({
    where: { id: { in: tagIds }, workspaceId: actor.workspaceId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
