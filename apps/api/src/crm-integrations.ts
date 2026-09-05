import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  assertSafeRemoteUrl,
  CRM_READ_ONLY_TOOL_NAMES,
  createCrmWebhookEmitter,
  createSafeRemoteFetch,
  crmAgentTools,
  type EncryptedSecretStore,
  executeCrmTool,
} from "@rakazo/adapters";
import {
  type Actor,
  CRM_MODULE_FIELD_MAX,
  CRM_MODULE_FIELD_TYPES,
  CRM_MODULE_NAME_MAX,
  type CrmModule,
  type CrmModuleRecord,
  INTEGRATION_SCOPES,
  type IntegrationScope,
} from "@rakazo/contracts";
import { createCrmRepos, IsolationError, type PrismaClient } from "@rakazo/db";
import type { Context, Hono } from "hono";
import * as z from "zod";
import {
  mountWorkspaceIntegrationRoutes,
  workspaceOpenApiPaths,
} from "./workspace-integrations.js";

export { INTEGRATION_SCOPES } from "@rakazo/contracts";

const WEBHOOK_EVENTS = [
  "contact.created",
  "contact.updated",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
  "record.created",
  "record.updated",
] as const;

const ContactUpsertSchema = z
  .object({
    source: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional(),
    external_id: z.string().trim().min(1).max(240).optional(),
    first_name: z.string().trim().min(1).max(120).optional(),
    last_name: z.string().trim().max(120).optional(),
    email: z.email().max(320).optional(),
    phone: z.string().trim().max(40).optional(),
    company: z.string().trim().max(200).optional(),
    notes: z.string().max(4000).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.source) !== Boolean(value.external_id)) {
      context.addIssue({
        code: "custom",
        message: "source and external_id must be provided together",
      });
    }
    if (!value.source && !value.email) {
      context.addIssue({ code: "custom", message: "source/external_id or email is required" });
    }
  });

const IntegrationCredentialInput = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(INTEGRATION_SCOPES)).min(1).max(INTEGRATION_SCOPES.length),
  expires_at: z.iso.datetime().nullable().optional(),
});

const WebhookInput = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.url().refine((value) => new URL(value).protocol === "https:", "HTTPS is required"),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
});

const DealCreateSchema = z.object({
  pipeline_id: z.string().trim().min(1),
  stage_id: z.string().trim().min(1),
  contact_id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(240),
  value: z.number().int().nonnegative(),
});

const DealUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    value: z.number().int().nonnegative().optional(),
    contact_id: z.string().trim().min(1).nullable().optional(),
    status: z.enum(["open", "won", "lost"]).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one deal field is required",
  });

const DealMoveSchema = z.object({ stage_id: z.string().trim().min(1) });

const ModuleCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(CRM_MODULE_NAME_MAX),
    fields: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(80),
          type: z.enum(CRM_MODULE_FIELD_TYPES),
          options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
        }),
      )
      .max(CRM_MODULE_FIELD_MAX)
      .default([]),
  })
  .superRefine((value, context) => {
    for (const field of value.fields) {
      if (field.type === "select" && !field.options.length) {
        context.addIssue({
          code: "custom",
          message: `Select field "${field.label}" needs at least one option`,
        });
      }
    }
  });

const RecordWriteSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export function parseCrmContactUpsert(value: unknown) {
  return ContactUpsertSchema.safeParse(value);
}

export function parseCrmPageLimit(value: string | undefined) {
  if (value === undefined) return { success: true, data: 50 } as const;
  return z.coerce.number().int().min(1).max(100).safeParse(value);
}

export function parseCrmUpdatedAfter(value: string | undefined) {
  if (value === undefined) return { success: true, data: undefined } as const;
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  return parsed.success
    ? ({ success: true, data: new Date(parsed.data) } as const)
    : ({ success: false, error: parsed.error } as const);
}

export function signCrmWebhook(secret: string, timestamp: string, body: string) {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export type IntegrationPrincipal = {
  credentialId: string;
  spaceId: string;
  organizationId: string;
  userId: string;
  scopes: IntegrationScope[];
};

type ContactUpsert = z.infer<typeof ContactUpsertSchema>;

function jsonError(message: string, status: number) {
  return { body: { error: { message } }, status };
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function integrationCredentialDto(row: {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: unknown;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.tokenPrefix,
    scopes: scopeList(row.scopes),
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    expires_at: row.expiresAt?.toISOString() ?? null,
    revoked_at: row.revokedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function scopeList(value: unknown): IntegrationScope[] {
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is IntegrationScope =>
    INTEGRATION_SCOPES.includes(scope as IntegrationScope),
  );
}

function externalIdList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = "source" in entry ? entry.source : undefined;
    const externalId = "externalId" in entry ? entry.externalId : undefined;
    return typeof source === "string" && typeof externalId === "string"
      ? [{ source, external_id: externalId }]
      : [];
  });
}

function publicContact(row: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  tags: { tag: { name: string } }[];
  externalIds: unknown;
}) {
  return {
    id: row.id,
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email,
    phone: row.phone,
    company: row.company,
    notes: row.notes,
    status: row.status === "archived" ? "archived" : "active",
    tags: row.tags.map(({ tag }) => tag.name),
    external_ids: externalIdList(row.externalIds),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function publicDeal(row: {
  id: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  title: string;
  value: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  pipeline?: { name: string };
  stage?: { name: string };
  contact?: { firstName: string; lastName: string; email: string | null } | null;
}) {
  return {
    id: row.id,
    pipeline_id: row.pipelineId,
    pipeline_name: row.pipeline?.name,
    stage_id: row.stageId,
    stage_name: row.stage?.name,
    contact_id: row.contactId,
    contact: row.contact
      ? {
          name: `${row.contact.firstName} ${row.contact.lastName}`.trim(),
          email: row.contact.email,
        }
      : null,
    title: row.title,
    value: row.value,
    status: row.status === "won" ? "won" : row.status === "lost" ? "lost" : "open",
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

const PUBLIC_CONTACT_INCLUDE = {
  tags: { include: { tag: true } },
  externalIds: { select: { source: true, externalId: true } },
} as const;

function encodeCursor(updatedAt: Date, id: string) {
  return Buffer.from(`${updatedAt.toISOString()}\n${id}`).toString("base64url");
}

function decodeCursor(value: string | undefined) {
  if (!value) return null;
  try {
    const [dateValue, id] = Buffer.from(value, "base64url").toString("utf8").split("\n");
    const updatedAt = new Date(dateValue ?? "");
    if (!id || !Number.isFinite(updatedAt.getTime())) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

export function createCrmIntegrationService(deps: {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  fetch?: typeof fetch;
}) {
  const { prisma, secrets } = deps;
  const webhookFetch = deps.fetch ?? createSafeRemoteFetch();

  async function authenticate(request: Request): Promise<IntegrationPrincipal | null> {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer manor_")) return null;
    const token = auth.slice(7).trim();
    const digest = tokenHash(token);
    const row = await prisma.integrationCredential.findUnique({ where: { tokenHash: digest } });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date())) return null;
    const stored = Buffer.from(row.tokenHash, "hex");
    const supplied = Buffer.from(digest, "hex");
    if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) return null;
    void prisma.integrationCredential
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    const space = await prisma.space.findUniqueOrThrow({
      where: { id: row.spaceId },
      select: { organizationId: true },
    });
    const member = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: row.spaceId, userId: row.createdByUserId } },
    });
    if (!member || member.organizationId !== space.organizationId) return null;
    return {
      credentialId: row.id,
      spaceId: row.spaceId,
      organizationId: space.organizationId,
      userId: row.createdByUserId,
      scopes: scopeList(row.scopes),
    };
  }

  async function createCredential(actor: Actor, input: z.infer<typeof IntegrationCredentialInput>) {
    const token = `manor_${randomBytes(30).toString("base64url")}`;
    const row = await prisma.integrationCredential.create({
      data: {
        spaceId: actor.spaceId,
        createdByUserId: actor.userId,
        name: input.name,
        tokenPrefix: `${token.slice(0, 14)}…`,
        tokenHash: tokenHash(token),
        scopes: [...new Set(input.scopes)],
        expiresAt: input.expires_at ? new Date(input.expires_at) : null,
      },
    });
    return { ...integrationCredentialDto(row), token };
  }

  async function upsertContact(organizationId: string, input: ContactUpsert) {
    const source = input.source?.toLowerCase();
    const lockIdentity = source
      ? `${source}:${input.external_id}`
      : `email:${input.email?.toLowerCase()}`;
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm-upsert:${organizationId}:${lockIdentity}`}))`;
      const linked =
        source && input.external_id
          ? await tx.crmContactExternalId.findUnique({
              where: {
                organizationId_source_externalId: {
                  organizationId,
                  source,
                  externalId: input.external_id,
                },
              },
              include: { contact: { include: PUBLIC_CONTACT_INCLUDE } },
            })
          : null;
      const byEmail =
        !linked && input.email
          ? await tx.crmContact.findFirst({
              where: { organizationId, email: { equals: input.email, mode: "insensitive" } },
              include: PUBLIC_CONTACT_INCLUDE,
              orderBy: { createdAt: "asc" },
            })
          : null;
      const existing = linked?.contact ?? byEmail;
      if (!existing && !input.first_name) {
        throw new Error("first_name is required when creating a contact");
      }
      const tagIds = input.tags
        ? await Promise.all(
            [...new Set(input.tags)].map(
              async (name) =>
                (
                  await tx.crmTag.upsert({
                    where: { organizationId_name: { organizationId, name } },
                    create: { organizationId, name },
                    update: {},
                  })
                ).id,
            ),
          )
        : undefined;
      const contact = existing
        ? await tx.crmContact.update({
            where: { id: existing.id },
            data: {
              firstName: input.first_name,
              lastName: input.last_name,
              email: input.email,
              phone: input.phone,
              company: input.company,
              notes: input.notes,
              status: input.status,
              ...(tagIds
                ? { tags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) } }
                : {}),
            },
            include: PUBLIC_CONTACT_INCLUDE,
          })
        : await tx.crmContact.create({
            data: {
              organizationId,
              firstName: input.first_name!,
              lastName: input.last_name ?? "",
              email: input.email ?? null,
              phone: input.phone ?? null,
              company: input.company ?? null,
              notes: input.notes ?? null,
              status: input.status ?? "active",
              tags: { create: (tagIds ?? []).map((tagId) => ({ tagId })) },
            },
            include: PUBLIC_CONTACT_INCLUDE,
          });
      if (source && input.external_id) {
        await tx.crmContactExternalId.upsert({
          where: {
            organizationId_source_externalId: {
              organizationId,
              source,
              externalId: input.external_id,
            },
          },
          create: {
            organizationId,
            contactId: contact.id,
            source,
            externalId: input.external_id,
          },
          update: { contactId: contact.id },
        });
      }
      const hydrated = await tx.crmContact.findUniqueOrThrow({
        where: { id: contact.id },
        include: PUBLIC_CONTACT_INCLUDE,
      });
      return { created: !existing, contact: publicContact(hydrated) };
    });
    await emitWebhook(
      organizationId,
      result.created ? "contact.created" : "contact.updated",
      result.contact.id,
      result.contact,
    );
    return result;
  }

  async function listContacts(
    organizationId: string,
    options: { limit: number; cursor?: string; updatedAfter?: Date },
  ) {
    const cursor = decodeCursor(options.cursor);
    if (options.cursor && !cursor) throw new Error("cursor is invalid");
    const rows = await prisma.crmContact.findMany({
      where: {
        organizationId,
        ...(options.updatedAfter ? { updatedAt: { gt: options.updatedAfter } } : {}),
        ...(cursor
          ? {
              OR: [
                { updatedAt: { gt: cursor.updatedAt } },
                { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      include: PUBLIC_CONTACT_INCLUDE,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: options.limit + 1,
    });
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    const last = page.at(-1);
    return {
      data: page.map(publicContact),
      next_cursor: hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
    };
  }

  async function getContact(organizationId: string, contactId: string) {
    const row = await prisma.crmContact.findFirst({
      where: { id: contactId, organizationId },
      include: PUBLIC_CONTACT_INCLUDE,
    });
    return row ? publicContact(row) : null;
  }

  async function listPipelines(organizationId: string) {
    return prisma.crmPipeline.findMany({
      where: { organizationId },
      include: { stages: { orderBy: { position: "asc" } } },
      orderBy: { position: "asc" },
    });
  }

  async function listDeals(organizationId: string, limit: number) {
    const rows = await prisma.crmDeal.findMany({
      where: { organizationId },
      include: {
        pipeline: { select: { name: true } },
        stage: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return { data: rows.map(publicDeal) };
  }

  async function createDeal(organizationId: string, input: z.infer<typeof DealCreateSchema>) {
    const repos = createCrmRepos(prisma);
    const created = await repos.createDeal(
      { organizationId },
      {
        pipelineId: input.pipeline_id,
        stageId: input.stage_id,
        contactId: input.contact_id,
        title: input.title,
        value: input.value,
      },
    );
    const row = await prisma.crmDeal.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        pipeline: { select: { name: true } },
        stage: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    const deal = publicDeal(row);
    await emitWebhook(organizationId, "deal.created", deal.id, deal);
    return { created: true, deal };
  }

  async function updateDeal(
    organizationId: string,
    dealId: string,
    input: z.infer<typeof DealUpdateSchema>,
  ) {
    const repos = createCrmRepos(prisma);
    await repos.updateDeal(
      { organizationId },
      {
        dealId,
        title: input.title,
        value: input.value,
        contactId: input.contact_id,
        status: input.status,
      },
    );
    const row = await prisma.crmDeal.findUniqueOrThrow({
      where: { id: dealId },
      include: {
        pipeline: { select: { name: true } },
        stage: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    const deal = publicDeal(row);
    await emitWebhook(organizationId, "deal.updated", deal.id, deal);
    return { updated: true, deal };
  }

  async function moveDeal(organizationId: string, dealId: string, stageId: string) {
    const repos = createCrmRepos(prisma);
    await repos.moveDeal({ organizationId }, dealId, stageId);
    const row = await prisma.crmDeal.findUniqueOrThrow({
      where: { id: dealId },
      include: {
        pipeline: { select: { name: true } },
        stage: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    const deal = publicDeal(row);
    await emitWebhook(organizationId, "deal.stage_changed", deal.id, deal);
    return { moved: true, deal };
  }

  async function listModules(organizationId: string) {
    const repos = createCrmRepos(prisma);
    const modules = await repos.listModules({ organizationId });
    return { data: modules.map(publicModule) };
  }

  async function createModule(organizationId: string, input: z.infer<typeof ModuleCreateSchema>) {
    const repos = createCrmRepos(prisma);
    const module = await repos.createModule({ organizationId }, input);
    return { created: true, module: publicModule(module) };
  }

  async function listModuleRecords(
    organizationId: string,
    moduleId: string,
    options: { limit: number; cursor?: string },
  ) {
    const repos = createCrmRepos(prisma);
    const page = await repos.listModuleRecords(
      { organizationId },
      { moduleId, cursor: options.cursor, limit: options.limit },
    );
    return { data: page.data.map(publicRecord), next_cursor: page.nextCursor };
  }

  async function createModuleRecord(
    organizationId: string,
    moduleId: string,
    values: Record<string, unknown>,
  ) {
    const repos = createCrmRepos(prisma);
    const record = publicRecord(
      await repos.createModuleRecord({ organizationId }, { moduleId, values }),
    );
    await emitWebhook(organizationId, "record.created", record.id, record);
    return { created: true, record };
  }

  async function updateModuleRecord(
    organizationId: string,
    recordId: string,
    values: Record<string, unknown>,
  ) {
    const repos = createCrmRepos(prisma);
    const record = publicRecord(
      await repos.updateModuleRecord({ organizationId }, { recordId, values }),
    );
    await emitWebhook(organizationId, "record.updated", record.id, record);
    return { updated: true, record };
  }

  async function deleteModuleRecord(organizationId: string, recordId: string) {
    const repos = createCrmRepos(prisma);
    await repos.deleteModuleRecord({ organizationId }, recordId);
    return { ok: true };
  }

  const emitWebhook = createCrmWebhookEmitter(prisma);

  async function withIdempotency<T extends object>(
    principal: IntegrationPrincipal,
    key: string | undefined,
    request: unknown,
    execute: () => Promise<T>,
  ): Promise<{ body: T; status: number }> {
    if (!key) return { body: await execute(), status: 200 };
    if (key.length > 200) throw new Error("Idempotency-Key must be 200 characters or fewer");
    const hash = requestHash(request);
    const resolveExisting = (existing: {
      requestHash: string;
      statusCode: number;
      response: unknown;
    }) => {
      if (existing.requestHash !== hash) {
        throw new Error("Idempotency-Key was already used for a different request");
      }
      if (existing.statusCode === 0) {
        throw new Error("A request with this Idempotency-Key is still in progress");
      }
      return { body: existing.response as T, status: existing.statusCode };
    };
    const existing = await prisma.integrationIdempotencyKey.findUnique({
      where: { credentialId_key: { credentialId: principal.credentialId, key } },
    });
    if (existing) return resolveExisting(existing);
    try {
      await prisma.integrationIdempotencyKey.create({
        data: {
          spaceId: principal.spaceId,
          credentialId: principal.credentialId,
          key,
          requestHash: hash,
          statusCode: 0,
          response: {},
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch {
      const raced = await prisma.integrationIdempotencyKey.findUniqueOrThrow({
        where: { credentialId_key: { credentialId: principal.credentialId, key } },
      });
      return resolveExisting(raced);
    }
    let body: T;
    try {
      body = await execute();
    } catch (error) {
      await prisma.integrationIdempotencyKey
        .delete({ where: { credentialId_key: { credentialId: principal.credentialId, key } } })
        .catch(() => undefined);
      throw error;
    }
    await prisma.integrationIdempotencyKey
      .update({
        where: { credentialId_key: { credentialId: principal.credentialId, key } },
        data: {
          statusCode: 200,
          response: body as never,
        },
      })
      .catch((error) => console.error("idempotency response persistence", error));
    return { body, status: 200 };
  }

  async function deliverPending(limit = 25) {
    const now = new Date();
    await Promise.all([
      prisma.crmWebhookDelivery.updateMany({
        where: {
          status: "delivering",
          updatedAt: { lt: new Date(now.getTime() - 2 * 60 * 1000) },
        },
        data: { status: "pending", nextAttemptAt: now },
      }),
      prisma.integrationIdempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.crmWebhookEvent.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);
    const rows = await prisma.crmWebhookDelivery.findMany({
      where: { status: { in: ["pending", "failed"] }, nextAttemptAt: { lte: now } },
      include: { endpoint: true, event: true },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
    });
    for (const row of rows) {
      const claimed = await prisma.crmWebhookDelivery.updateMany({
        where: { id: row.id, status: { in: ["pending", "failed"] }, nextAttemptAt: { lte: now } },
        data: { status: "delivering", attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      const body = JSON.stringify({
        id: row.event.id,
        type: row.event.type,
        created_at: row.event.createdAt.toISOString(),
        data: row.event.payload,
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const secret = secrets.load(row.endpoint.signingSecret, row.endpoint.id);
      const signature = signCrmWebhook(secret, timestamp, body);
      try {
        const response = await webhookFetch(row.endpoint.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Manor-Webhooks/1.0",
            "x-manor-event": row.event.type,
            "x-manor-delivery": row.id,
            "x-manor-timestamp": timestamp,
            "x-manor-signature": signature,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await prisma.crmWebhookDelivery.update({
          where: { id: row.id },
          data: { status: "delivered", deliveredAt: new Date(), lastError: null },
        });
      } catch (error) {
        const attempts = row.attempts + 1;
        const terminal = attempts >= 8;
        const delay = Math.min(60 * 60 * 1000, 2 ** attempts * 5_000);
        await prisma.crmWebhookDelivery.update({
          where: { id: row.id },
          data: {
            status: terminal ? "dead" : "pending",
            nextAttemptAt: new Date(Date.now() + delay),
            lastError: error instanceof Error ? error.message.slice(0, 500) : "Delivery failed",
          },
        });
      }
    }
  }

  return {
    authenticate,
    createCredential,
    upsertContact,
    listContacts,
    getContact,
    listPipelines,
    listDeals,
    createDeal,
    updateDeal,
    moveDeal,
    listModules,
    createModule,
    listModuleRecords,
    createModuleRecord,
    updateModuleRecord,
    deleteModuleRecord,
    emitWebhook,
    withIdempotency,
    deliverPending,
    close: async () => {
      if ("close" in webhookFetch && typeof webhookFetch.close === "function") {
        await webhookFetch.close();
      }
    },
    parseCredentialInput: IntegrationCredentialInput.safeParse,
    parseContactUpsert: parseCrmContactUpsert,
    parseWebhookInput: WebhookInput.safeParse,
    parseDealCreate: DealCreateSchema.safeParse,
    parseDealUpdate: DealUpdateSchema.safeParse,
    parseDealMove: DealMoveSchema.safeParse,
    parseModuleCreate: ModuleCreateSchema.safeParse,
    parseRecordWrite: RecordWriteSchema.safeParse,
  };
}

function publicModule(module: CrmModule) {
  return {
    id: module.id,
    name: module.name,
    record_count: module.recordCount,
    fields: module.fields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      options: field.options,
      position: field.position,
    })),
    created_at: module.createdAt,
  };
}

function publicRecord(record: CrmModuleRecord) {
  return {
    id: record.id,
    module_id: record.moduleId,
    values: record.values,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

type CrmIntegrationService = ReturnType<typeof createCrmIntegrationService>;

function hasScope(principal: IntegrationPrincipal, scope: IntegrationScope) {
  return principal.scopes.includes(scope);
}

function webhookDto(row: {
  id: string;
  name: string;
  url: string;
  events: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: Array.isArray(row.events) ? row.events : [],
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function mountCrmIntegrationRoutes(
  app: Hono,
  deps: {
    prisma: PrismaClient;
    secrets: EncryptedSecretStore;
    resolveActor: (request: Request) => Promise<Actor | null>;
    service?: CrmIntegrationService;
  },
) {
  const service = deps.service ?? createCrmIntegrationService(deps);
  const resolveOwner = async (request: Request) => {
    const actor = await deps.resolveActor(request);
    if (!actor) return null;
    const member = await deps.prisma.member.findFirst({
      where: { organizationId: actor.organizationId, userId: actor.userId },
      select: { role: true },
    });
    return member?.role.split(",").some((role) => role.trim() === "owner") ? actor : null;
  };

  mountWorkspaceIntegrationRoutes(app, { prisma: deps.prisma, authenticate: service.authenticate });
  app.get("/v1/openapi.json", (c) => {
    const document = crmOpenApiDocument(new URL(c.req.url).origin);
    return c.json({ ...document, paths: { ...document.paths, ...workspaceOpenApiPaths() } });
  });

  app.get("/v1/integration-credentials", async (c) => {
    const actor = await resolveOwner(c.req.raw);
    if (!actor) return c.json(jsonError("Authentication required", 401).body, 401);
    const rows = await deps.prisma.integrationCredential.findMany({
      where: { spaceId: actor.spaceId },
      orderBy: { createdAt: "desc" },
    });
    return c.json({ data: rows.map(integrationCredentialDto) });
  });

  app.post("/v1/integration-credentials", async (c) => {
    const actor = await resolveOwner(c.req.raw);
    if (!actor) return c.json(jsonError("Authentication required", 401).body, 401);
    const parsed = service.parseCredentialInput(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(jsonError(z.prettifyError(parsed.error), 400).body, 400);
    return c.json(await service.createCredential(actor, parsed.data), 201);
  });

  app.delete("/v1/integration-credentials/:id", async (c) => {
    const actor = await resolveOwner(c.req.raw);
    if (!actor) return c.json(jsonError("Authentication required", 401).body, 401);
    const changed = await deps.prisma.integrationCredential.updateMany({
      where: { id: c.req.param("id"), spaceId: actor.spaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return changed.count
      ? c.json({ ok: true })
      : c.json(jsonError("Credential not found", 404).body, 404);
  });

  app.get("/v1/crm/contacts", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:read"))
      return c.json(jsonError("Missing crm:read scope", 403).body, 403);
    const limit = parseCrmPageLimit(c.req.query("limit"));
    if (!limit.success) {
      return c.json(jsonError("limit must be an integer from 1 to 100", 400).body, 400);
    }
    const updatedAfter = parseCrmUpdatedAfter(c.req.query("updated_after"));
    if (!updatedAfter.success) {
      return c.json(jsonError("updated_after must be an ISO timestamp", 400).body, 400);
    }
    try {
      return c.json(
        await service.listContacts(principal.organizationId, {
          limit: limit.data,
          cursor: c.req.query("cursor"),
          updatedAfter: updatedAfter.data,
        }),
      );
    } catch (error) {
      return c.json(
        jsonError(error instanceof Error ? error.message : "Invalid request", 400).body,
        400,
      );
    }
  });

  app.post("/v1/crm/contacts/upsert", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:write"))
      return c.json(jsonError("Missing crm:write scope", 403).body, 403);
    const parsed = service.parseContactUpsert(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(jsonError(z.prettifyError(parsed.error), 400).body, 400);
    try {
      const result = await service.withIdempotency(
        principal,
        c.req.header("idempotency-key"),
        parsed.data,
        () => service.upsertContact(principal.organizationId, parsed.data),
      );
      return c.json(result.body, result.status as 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not upsert contact";
      return c.json(
        jsonError(message, message.includes("Idempotency-Key") ? 409 : 400).body,
        message.includes("Idempotency-Key") ? 409 : 400,
      );
    }
  });

  app.get("/v1/crm/contacts/:id", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:read"))
      return c.json(jsonError("Missing crm:read scope", 403).body, 403);
    const contact = await service.getContact(principal.organizationId, c.req.param("id"));
    return contact ? c.json(contact) : c.json(jsonError("Contact not found", 404).body, 404);
  });

  app.get("/v1/crm/pipelines", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:read"))
      return c.json(jsonError("Missing crm:read scope", 403).body, 403);
    const rows = await service.listPipelines(principal.organizationId);
    return c.json({
      data: rows.map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        position: pipeline.position,
        stages: pipeline.stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          position: stage.position,
        })),
      })),
    });
  });

  app.get("/v1/crm/deals", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:read"))
      return c.json(jsonError("Missing crm:read scope", 403).body, 403);
    const limit = parseCrmPageLimit(c.req.query("limit"));
    if (!limit.success) {
      return c.json(jsonError("limit must be an integer from 1 to 100", 400).body, 400);
    }
    return c.json(await service.listDeals(principal.organizationId, limit.data));
  });

  app.post("/v1/crm/deals", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:write"))
      return c.json(jsonError("Missing crm:write scope", 403).body, 403);
    const parsed = service.parseDealCreate(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(jsonError(z.prettifyError(parsed.error), 400).body, 400);
    try {
      const result = await service.withIdempotency(
        principal,
        c.req.header("idempotency-key"),
        parsed.data,
        () => service.createDeal(principal.organizationId, parsed.data),
      );
      return c.json(result.body, result.status as 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create deal";
      const status = message.includes("Idempotency-Key") ? 409 : 400;
      return c.json(jsonError(message, status).body, status as 400 | 409);
    }
  });

  app.patch("/v1/crm/deals/:id", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:write"))
      return c.json(jsonError("Missing crm:write scope", 403).body, 403);
    const parsed = service.parseDealUpdate(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(jsonError(z.prettifyError(parsed.error), 400).body, 400);
    try {
      return c.json(
        await service.updateDeal(principal.organizationId, c.req.param("id"), parsed.data),
      );
    } catch (error) {
      return c.json(
        jsonError(error instanceof Error ? error.message : "Could not update deal", 400).body,
        400,
      );
    }
  });

  app.post("/v1/crm/deals/:id/move", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:write"))
      return c.json(jsonError("Missing crm:write scope", 403).body, 403);
    const parsed = service.parseDealMove(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(jsonError(z.prettifyError(parsed.error), 400).body, 400);
    try {
      return c.json(
        await service.moveDeal(principal.organizationId, c.req.param("id"), parsed.data.stage_id),
      );
    } catch (error) {
      return c.json(
        jsonError(error instanceof Error ? error.message : "Could not move deal", 400).body,
        400,
      );
    }
  });

  const moduleFailure = (c: Context, error: unknown) => {
    if (error instanceof IsolationError) return c.json(jsonError("Not found", 404).body, 404);
    const message = error instanceof Error ? error.message : "Invalid request";
    const status = message.includes("Idempotency-Key") ? 409 : 400;
    return c.json(jsonError(message, status).body, status as 400 | 409);
  };

  app.get("/v1/crm/modules", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:read"))
      return c.json(jsonError("Missing crm:read scope", 403).body, 403);
    return c.json(await service.listModules(principal.organizationId));
  });

  app.post("/v1/crm/modules", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:write"))
      return c.json(jsonError("Missing crm:write scope", 403).body, 403);
    const parsed = service.parseModuleCreate(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(jsonError(z.prettifyError(parsed.error), 400).body, 400);
    try {
      const result = await service.withIdempotency(
        principal,
        c.req.header("idempotency-key"),
        parsed.data,
        () => service.createModule(principal.organizationId, parsed.data),
      );
      return c.json(result.body, result.status as 200);
    } catch (error) {
      return moduleFailure(c, error);
    }
  });

  app.get("/v1/crm/modules/:id/records", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:read"))
      return c.json(jsonError("Missing crm:read scope", 403).body, 403);
    const limit = parseCrmPageLimit(c.req.query("limit"));
    if (!limit.success) {
      return c.json(jsonError("limit must be an integer from 1 to 100", 400).body, 400);
    }
    try {
      return c.json(
        await service.listModuleRecords(principal.organizationId, c.req.param("id"), {
          limit: limit.data,
          cursor: c.req.query("cursor"),
        }),
      );
    } catch (error) {
      return moduleFailure(c, error);
    }
  });

  app.post("/v1/crm/modules/:id/records", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:write"))
      return c.json(jsonError("Missing crm:write scope", 403).body, 403);
    const parsed = service.parseRecordWrite(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(jsonError(z.prettifyError(parsed.error), 400).body, 400);
    try {
      const result = await service.withIdempotency(
        principal,
        c.req.header("idempotency-key"),
        parsed.data,
        () =>
          service.createModuleRecord(
            principal.organizationId,
            c.req.param("id"),
            parsed.data.values,
          ),
      );
      return c.json(result.body, result.status as 200);
    } catch (error) {
      return moduleFailure(c, error);
    }
  });

  app.patch("/v1/crm/records/:id", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:write"))
      return c.json(jsonError("Missing crm:write scope", 403).body, 403);
    const parsed = service.parseRecordWrite(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(jsonError(z.prettifyError(parsed.error), 400).body, 400);
    try {
      return c.json(
        await service.updateModuleRecord(
          principal.organizationId,
          c.req.param("id"),
          parsed.data.values,
        ),
      );
    } catch (error) {
      return moduleFailure(c, error);
    }
  });

  app.delete("/v1/crm/records/:id", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    if (!hasScope(principal, "crm:write"))
      return c.json(jsonError("Missing crm:write scope", 403).body, 403);
    try {
      return c.json(await service.deleteModuleRecord(principal.organizationId, c.req.param("id")));
    } catch (error) {
      return moduleFailure(c, error);
    }
  });

  app.get("/v1/webhooks", async (c) => {
    const actor = await resolveOwner(c.req.raw);
    const principal = actor ? null : await service.authenticate(c.req.raw);
    const organizationId = actor?.organizationId ?? principal?.organizationId;
    if (!organizationId) return c.json(jsonError("Authentication required", 401).body, 401);
    if (principal && !hasScope(principal, "webhooks:manage")) {
      return c.json(jsonError("Missing webhooks:manage scope", 403).body, 403);
    }
    const rows = await deps.prisma.crmWebhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return c.json({ data: rows.map(webhookDto) });
  });

  app.post("/v1/webhooks", async (c) => {
    const actor = await resolveOwner(c.req.raw);
    const principal = actor ? null : await service.authenticate(c.req.raw);
    // The signing secret's associated data is bound to the space the webhook
    // was created from (the platform-wide secret-store contract), even
    // though the endpoint row itself is org-scoped like the rest of the CRM.
    const spaceId = actor?.spaceId ?? principal?.spaceId;
    const organizationId = actor?.organizationId ?? principal?.organizationId;
    const userId = actor?.userId ?? principal?.userId;
    if (!spaceId || !organizationId || !userId) {
      return c.json(jsonError("Authentication required", 401).body, 401);
    }
    if (principal && !hasScope(principal, "webhooks:manage")) {
      return c.json(jsonError("Missing webhooks:manage scope", 403).body, 403);
    }
    const parsed = service.parseWebhookInput(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(jsonError(z.prettifyError(parsed.error), 400).body, 400);
    try {
      await assertSafeRemoteUrl(parsed.data.url);
    } catch (error) {
      return c.json(
        jsonError(
          error instanceof Error
            ? error.message.replace("Connector", "Webhook")
            : "Unsafe webhook URL",
          400,
        ).body,
        400,
      );
    }
    const signingSecret = `whsec_${randomBytes(24).toString("base64url")}`;
    // The secret store binds the record id into the AEAD tag, so the endpoint id
    // has to exist before the secret is sealed.
    const endpointId = randomBytes(16).toString("hex");
    const encrypted = await deps.secrets.put(
      signingSecret,
      {
        operationId: `webhook-create:${spaceId}`,
        traceId: `webhook-create:${spaceId}`,
        spaceId,
        userId,
        signal: c.req.raw.signal,
      },
      endpointId,
    );
    const row = await deps.prisma.crmWebhookEndpoint.create({
      data: {
        id: endpointId,
        organizationId,
        createdByUserId: userId,
        name: parsed.data.name,
        url: parsed.data.url,
        events: parsed.data.events,
        signingSecret: encrypted.ciphertext,
      },
    });
    return c.json({ ...webhookDto(row), signing_secret: signingSecret }, 201);
  });

  app.delete("/v1/webhooks/:id", async (c) => {
    const actor = await resolveOwner(c.req.raw);
    const principal = actor ? null : await service.authenticate(c.req.raw);
    const organizationId = actor?.organizationId ?? principal?.organizationId;
    if (!organizationId) return c.json(jsonError("Authentication required", 401).body, 401);
    if (principal && !hasScope(principal, "webhooks:manage")) {
      return c.json(jsonError("Missing webhooks:manage scope", 403).body, 403);
    }
    const changed = await deps.prisma.crmWebhookEndpoint.deleteMany({
      where: { id: c.req.param("id"), organizationId },
    });
    return changed.count
      ? c.json({ ok: true })
      : c.json(jsonError("Webhook not found", 404).body, 404);
  });

  app.all("/mcp/crm", async (c) => {
    const principal = await service.authenticate(c.req.raw);
    if (!principal) return c.json(jsonError("Invalid integration credential", 401).body, 401);
    const server = new McpServer(
      { name: "Manor CRM", version: "1.0.0" },
      { instructions: "Use these tools to read and update the authenticated Manor workspace CRM." },
    );
    const toolSchemas = crmMcpSchemas();
    const readOnly: readonly string[] = CRM_READ_ONLY_TOOL_NAMES;
    for (const tool of crmAgentTools) {
      const mutating = !readOnly.includes(tool.name);
      const requiredScope: IntegrationScope = mutating ? "crm:write" : "crm:read";
      if (!hasScope(principal, requiredScope)) continue;
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: toolSchemas[tool.name] ?? {},
          annotations: { readOnlyHint: !mutating, openWorldHint: false },
        },
        async (args) => {
          const result = await executeCrmTool(
            createCrmRepos(deps.prisma),
            { organizationId: principal.organizationId, userId: principal.userId },
            tool.name,
            args,
          );
          if (result && typeof result === "object") {
            const value = result as Record<string, unknown>;
            const contact = value.contact as { id?: string } | undefined;
            const deal = value.deal as { id?: string } | undefined;
            if (contact?.id && (value.created || value.updated)) {
              await service.emitWebhook(
                principal.organizationId,
                value.created ? "contact.created" : "contact.updated",
                contact.id,
                contact,
              );
            }
            if (deal?.id && (value.created || value.updated || value.moved)) {
              await service.emitWebhook(
                principal.organizationId,
                value.created
                  ? "deal.created"
                  : value.moved
                    ? "deal.stage_changed"
                    : "deal.updated",
                deal.id,
                deal,
              );
            }
            const record = value.record as { id?: string } | undefined;
            if (record?.id && (value.created || value.updated)) {
              await service.emitWebhook(
                principal.organizationId,
                value.created ? "record.created" : "record.updated",
                record.id,
                record,
              );
            }
          }
          return { content: [{ type: "text", text: JSON.stringify(result ?? null) }] };
        },
      );
    }
    if (hasScope(principal, "crm:write")) {
      server.registerTool(
        "crm_sync_contact",
        {
          description:
            "Idempotently create or update a CRM contact using an external source/id or email.",
          inputSchema: {
            source: z.string().optional(),
            external_id: z.string().optional(),
            first_name: z.string().optional(),
            last_name: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            company: z.string().optional(),
            notes: z.string().optional(),
            tags: z.array(z.string()).optional(),
          },
          annotations: { readOnlyHint: false, openWorldHint: false },
        },
        async (args) => {
          const parsed = service.parseContactUpsert(args);
          if (!parsed.success) {
            return {
              content: [{ type: "text", text: z.prettifyError(parsed.error) }],
              isError: true,
            };
          }
          const result = await service.upsertContact(principal.organizationId, parsed.data);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    if (stopped) return;
    await service.deliverPending().catch((error) => console.error("crm webhook delivery", error));
    if (!stopped) timer = setTimeout(poll, 5_000);
  };
  timer = setTimeout(poll, 1_000);
  return {
    service,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await service.close().catch(() => undefined);
    },
  };
}

function crmMcpSchemas(): Record<string, Record<string, z.ZodType>> {
  return {
    crm_overview: {},
    crm_find_contacts: { query: z.string() },
    crm_upsert_contact: {
      contact_id: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.enum(["active", "archived"]).optional(),
    },
    crm_create_deal: {
      title: z.string(),
      value: z.number(),
      pipeline: z.string().optional(),
      stage: z.string().optional(),
      contact_id: z.string().optional(),
      contact_name: z.string().optional(),
    },
    crm_update_deal: {
      deal_id: z.string(),
      title: z.string().optional(),
      value: z.number().optional(),
      contact_id: z.string().optional(),
      status: z.enum(["open", "won", "lost"]).optional(),
    },
    crm_move_deal: { deal_id: z.string(), stage: z.string() },
    crm_list_modules: {},
    crm_create_module: {
      name: z.string(),
      fields: z
        .array(
          z.object({
            label: z.string(),
            type: z.enum(CRM_MODULE_FIELD_TYPES),
            options: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    },
    crm_list_records: { module: z.string(), cursor: z.string().optional() },
    crm_upsert_record: {
      module: z.string().optional(),
      record_id: z.string().optional(),
      values: z.record(z.string(), z.unknown()),
    },
    crm_delete_record: { record_id: z.string() },
  };
}

export function crmOpenApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Manor CRM Integration API",
      version: "1.0.0",
      description:
        "Synchronize contacts and subscribe to CRM changes without an agent in the loop.",
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/v1/crm/contacts": {
        get: {
          summary: "List contacts",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "updated_after", in: "query", schema: { type: "string", format: "date-time" } },
          ],
          responses: { "200": { description: "A page of contacts" } },
        },
      },
      "/v1/crm/contacts/upsert": {
        post: {
          summary: "Idempotently create or update a contact",
          parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    source: { type: "string" },
                    external_id: { type: "string" },
                    first_name: { type: "string" },
                    last_name: { type: "string" },
                    email: { type: "string", format: "email" },
                    phone: { type: "string" },
                    company: { type: "string" },
                    notes: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    status: { type: "string", enum: ["active", "archived"] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "The synchronized contact" } },
        },
      },
      "/v1/crm/contacts/{id}": {
        get: {
          summary: "Get a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Contact" },
            "404": { description: "Contact not found" },
          },
        },
      },
      "/v1/crm/pipelines": {
        get: {
          summary: "List pipelines and stages",
          responses: { "200": { description: "Pipelines" } },
        },
      },
      "/v1/crm/deals": {
        get: {
          summary: "List deals",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          ],
          responses: { "200": { description: "Deals" } },
        },
        post: {
          summary: "Create a deal",
          parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["pipeline_id", "stage_id", "title", "value"],
                  properties: {
                    pipeline_id: { type: "string" },
                    stage_id: { type: "string" },
                    contact_id: { type: "string" },
                    title: { type: "string" },
                    value: { type: "integer", minimum: 0 },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Created deal" } },
        },
      },
      "/v1/crm/deals/{id}": {
        patch: {
          summary: "Update a deal",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    value: { type: "integer", minimum: 0 },
                    contact_id: { type: ["string", "null"] },
                    status: { type: "string", enum: ["open", "won", "lost"] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated deal" } },
        },
      },
      "/v1/crm/deals/{id}/move": {
        post: {
          summary: "Move a deal to a pipeline stage",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["stage_id"],
                  properties: { stage_id: { type: "string" } },
                },
              },
            },
          },
          responses: { "200": { description: "Moved deal" } },
        },
      },
      "/v1/crm/modules": {
        get: {
          summary: "List custom modules and their fields",
          responses: { "200": { description: "Modules" } },
        },
        post: {
          summary: "Create a custom module (a user-defined sheet)",
          parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    fields: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["label", "type"],
                        properties: {
                          label: { type: "string" },
                          type: { type: "string", enum: [...CRM_MODULE_FIELD_TYPES] },
                          options: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Created module" } },
        },
      },
      "/v1/crm/modules/{id}/records": {
        get: {
          summary: "List records in a module",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "A page of records" } },
        },
        post: {
          summary: "Create a record; values map field ids or labels to values",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "Idempotency-Key", in: "header", schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["values"],
                  properties: { values: { type: "object", additionalProperties: true } },
                },
              },
            },
          },
          responses: { "200": { description: "Created record" } },
        },
      },
      "/v1/crm/records/{id}": {
        patch: {
          summary: "Update a record's values (null clears a field)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["values"],
                  properties: { values: { type: "object", additionalProperties: true } },
                },
              },
            },
          },
          responses: { "200": { description: "Updated record" } },
        },
        delete: {
          summary: "Delete a record",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Record deleted" } },
        },
      },
      "/v1/webhooks": {
        get: {
          summary: "List webhook endpoints",
          responses: { "200": { description: "Webhook endpoints" } },
        },
        post: {
          summary: "Create a webhook endpoint",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "url", "events"],
                  properties: {
                    name: { type: "string" },
                    url: { type: "string", format: "uri", pattern: "^https://" },
                    events: {
                      type: "array",
                      minItems: 1,
                      items: { type: "string", enum: [...WEBHOOK_EVENTS] },
                    },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Endpoint and one-time signing secret" } },
        },
      },
      "/v1/webhooks/{id}": {
        delete: {
          summary: "Delete a webhook endpoint",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Endpoint deleted" },
            "404": { description: "Endpoint not found" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "manor_…" },
      },
    },
  };
}
