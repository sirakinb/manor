import type { ConnectorTool } from "@rakazo/adapter-kit";
import type { CrmContact, CrmDeal, CrmOverview, CrmPipeline } from "@rakazo/contracts";
import { type createCrmRepos, IsolationError, type PrismaClient } from "@rakazo/db";

/**
 * The CRM as agent tools, so chat and voice can read and work the board.
 * Manor-owned module: the only touchpoints in upstream files are one spread
 * in builtin-tools.ts and one dispatch block in executor.ts.
 */

export type CrmRepos = ReturnType<typeof createCrmRepos>;
export type CrmToolScope = { userId: string; workspaceId: string };

export const CRM_READ_ONLY_TOOL_NAMES = ["crm_overview", "crm_find_contacts"] as const;

export const crmAgentTools: ConnectorTool[] = [
  {
    name: "crm_overview",
    description:
      "Read this workspace's CRM: pipelines with their stages and per-stage open deal counts and values, overall totals, deals, recent contacts, and tags. Call this first to get the ids and stage names other crm_ tools need.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_find_contacts",
    description:
      "Search CRM contacts by name, company, email, or phone. Every word in the query must match one of those fields. Returns matching contacts with their deals.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Search words, e.g. "john acme".' },
      },
      required: ["query"],
    },
  },
  {
    name: "crm_upsert_contact",
    description:
      "Create a CRM contact, or update one when contact_id is given. On update, only the provided fields change; tags replaces the contact's tag list (tag names are created if new).",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "Existing contact id to update." },
        first_name: { type: "string", description: "Required when creating." },
        last_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        company: { type: "string" },
        notes: { type: "string" },
        tags: { type: "array", items: { type: "string" }, description: "Tag names." },
        status: { type: "string", enum: ["active", "archived"] },
      },
    },
  },
  {
    name: "crm_create_deal",
    description:
      "Open a deal on the CRM board. value is whole dollars. pipeline and stage are matched by name (defaults: the first pipeline, its first stage). Link a contact with contact_id, or contact_name to look one up.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: 'E.g. "Water heater install — Smith".' },
        value: { type: "number", description: "Deal value in whole dollars." },
        pipeline: { type: "string", description: "Pipeline name; defaults to the first." },
        stage: { type: "string", description: "Stage name; defaults to the first stage." },
        contact_id: { type: "string" },
        contact_name: {
          type: "string",
          description: "Find the contact by name/company instead of contact_id.",
        },
      },
      required: ["title", "value"],
    },
  },
  {
    name: "crm_update_deal",
    description:
      "Update a deal's title, value (whole dollars), linked contact, or status. Mark deals won or lost by setting status.",
    inputSchema: {
      type: "object",
      properties: {
        deal_id: { type: "string" },
        title: { type: "string" },
        value: { type: "number" },
        contact_id: { type: "string" },
        status: { type: "string", enum: ["open", "won", "lost"] },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "crm_move_deal",
    description:
      "Move a deal to another stage of its pipeline. stage is matched by name, case-insensitively.",
    inputSchema: {
      type: "object",
      properties: {
        deal_id: { type: "string" },
        stage: { type: "string", description: 'Target stage name, e.g. "Proposal".' },
      },
      required: ["deal_id", "stage"],
    },
  },
];

const CRM_TOOL_NAMES = new Set(crmAgentTools.map((tool) => tool.name));

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function wholeDollars(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed);
}

export function resolvePipelineByName(
  pipelines: CrmPipeline[],
  name: string | undefined,
): CrmPipeline | { error: string } {
  if (!pipelines.length) return { error: "This workspace has no CRM pipelines yet." };
  if (!name) return pipelines[0]!;
  const wanted = name.trim().toLowerCase();
  const match = pipelines.find((pipeline) => pipeline.name.toLowerCase() === wanted);
  if (match) return match;
  return {
    error: `No pipeline named "${name}". Pipelines: ${pipelines.map((p) => p.name).join(", ")}.`,
  };
}

export function resolveStageByName(
  pipeline: CrmPipeline,
  name: string | undefined,
): CrmPipeline["stages"][number] | { error: string } {
  if (!pipeline.stages.length) return { error: `Pipeline "${pipeline.name}" has no stages.` };
  if (!name) return pipeline.stages[0]!;
  const wanted = name.trim().toLowerCase();
  const match = pipeline.stages.find((stage) => stage.name.toLowerCase() === wanted);
  if (match) return match;
  return {
    error: `No stage named "${name}" in "${pipeline.name}". Stages: ${pipeline.stages
      .map((stage) => stage.name)
      .join(", ")}.`,
  };
}

function contactSummary(contact: CrmContact) {
  return {
    id: contact.id,
    name: `${contact.firstName} ${contact.lastName}`.trim(),
    company: contact.company,
    email: contact.email,
    phone: contact.phone,
    status: contact.status,
    tags: contact.tags.map((tag) => tag.name),
    notes: contact.notes,
  };
}

function dealSummary(deal: CrmDeal, pipelines: CrmPipeline[]) {
  const pipeline = pipelines.find((candidate) => candidate.id === deal.pipelineId);
  const stage = pipeline?.stages.find((candidate) => candidate.id === deal.stageId);
  return {
    id: deal.id,
    title: deal.title,
    value: deal.value,
    status: deal.status,
    pipeline: pipeline?.name,
    stage: stage?.name,
    contact_id: deal.contactId,
  };
}

export function summarizeOverview(overview: CrmOverview) {
  const openDeals = overview.deals.filter((deal) => deal.status === "open");
  const total = (deals: CrmDeal[]) => deals.reduce((sum, deal) => sum + deal.value, 0);
  return {
    pipelines: overview.pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: pipeline.stages.map((stage) => {
        const stageDeals = openDeals.filter((deal) => deal.stageId === stage.id);
        return {
          id: stage.id,
          name: stage.name,
          open_deals: stageDeals.length,
          open_value: total(stageDeals),
        };
      }),
    })),
    totals: {
      open_deals: openDeals.length,
      open_value: total(openDeals),
      won_deals: overview.deals.filter((deal) => deal.status === "won").length,
      won_value: total(overview.deals.filter((deal) => deal.status === "won")),
      lost_deals: overview.deals.filter((deal) => deal.status === "lost").length,
    },
    deals: overview.deals.slice(0, 25).map((deal) => dealSummary(deal, overview.pipelines)),
    recent_contacts: overview.contacts.slice(0, 10).map(contactSummary),
    contact_count: overview.contacts.length,
    tags: overview.tags.map((tag) => tag.name),
  };
}

/** Runs a crm_ tool; returns undefined when the name is not a CRM tool. */
export async function executeCrmTool(
  repos: CrmRepos,
  scope: CrmToolScope,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown | undefined> {
  if (!CRM_TOOL_NAMES.has(name)) return undefined;
  const actor = { workspaceId: scope.workspaceId };
  try {
    if (name === "crm_overview") {
      return summarizeOverview(await repos.overview(actor));
    }
    if (name === "crm_find_contacts") {
      const query = text(args.query);
      if (!query) return { error: "query is required." };
      const [contacts, overview] = await Promise.all([
        repos.searchContacts(actor, query),
        repos.overview(actor),
      ]);
      return {
        contacts: contacts.map((contact) => ({
          ...contactSummary(contact),
          deals: overview.deals
            .filter((deal) => deal.contactId === contact.id)
            .map((deal) => dealSummary(deal, overview.pipelines)),
        })),
      };
    }
    if (name === "crm_upsert_contact") {
      const tagNames = Array.isArray(args.tags)
        ? args.tags.map((tag) => text(tag)).filter((tag): tag is string => Boolean(tag))
        : undefined;
      const tagIds =
        tagNames === undefined
          ? undefined
          : await Promise.all(
              tagNames.map(async (tagName) => (await repos.createTag(actor, { name: tagName })).id),
            );
      const contactId = text(args.contact_id);
      if (contactId) {
        const contact = await repos.updateContact(actor, {
          contactId,
          firstName: text(args.first_name),
          lastName: text(args.last_name),
          email: text(args.email),
          phone: text(args.phone),
          company: text(args.company),
          notes: text(args.notes),
          status:
            args.status === "archived"
              ? "archived"
              : args.status === "active"
                ? "active"
                : undefined,
          tagIds,
        });
        return { updated: true, contact: contactSummary(contact) };
      }
      const firstName = text(args.first_name);
      if (!firstName) return { error: "first_name is required to create a contact." };
      const contact = await repos.createContact(actor, {
        firstName,
        lastName: text(args.last_name) ?? "",
        email: text(args.email),
        phone: text(args.phone),
        company: text(args.company),
        notes: text(args.notes),
        tagIds,
      });
      return { created: true, contact: contactSummary(contact) };
    }
    if (name === "crm_create_deal") {
      const title = text(args.title);
      if (!title) return { error: "title is required." };
      const value = wholeDollars(args.value);
      if (value === undefined) return { error: "value must be a non-negative dollar amount." };
      let overview = await repos.overview(actor);
      if (!overview.pipelines.length) overview = await repos.seedDefaultPipeline(actor);
      const pipeline = resolvePipelineByName(overview.pipelines, text(args.pipeline));
      if ("error" in pipeline) return pipeline;
      const stage = resolveStageByName(pipeline, text(args.stage));
      if ("error" in stage) return stage;
      let contactId = text(args.contact_id);
      const contactName = text(args.contact_name);
      if (!contactId && contactName) {
        const matches = await repos.searchContacts(actor, contactName);
        if (!matches.length) {
          return {
            error: `No contact matching "${contactName}". Create one with crm_upsert_contact first.`,
          };
        }
        if (matches.length > 1) {
          return {
            error: `Multiple contacts match "${contactName}"; pass contact_id instead.`,
            candidates: matches.map(contactSummary),
          };
        }
        contactId = matches[0]!.id;
      }
      const deal = await repos.createDeal(actor, {
        pipelineId: pipeline.id,
        stageId: stage.id,
        title,
        value,
        contactId,
      });
      return { created: true, deal: dealSummary(deal, overview.pipelines) };
    }
    if (name === "crm_update_deal") {
      const dealId = text(args.deal_id);
      if (!dealId) return { error: "deal_id is required." };
      const value = args.value === undefined ? undefined : wholeDollars(args.value);
      if (args.value !== undefined && value === undefined) {
        return { error: "value must be a non-negative dollar amount." };
      }
      const status =
        args.status === "won" || args.status === "lost" || args.status === "open"
          ? args.status
          : undefined;
      const deal = await repos.updateDeal(actor, {
        dealId,
        title: text(args.title),
        value,
        contactId: text(args.contact_id),
        status,
      });
      const overview = await repos.overview(actor);
      return { updated: true, deal: dealSummary(deal, overview.pipelines) };
    }
    if (name === "crm_move_deal") {
      const dealId = text(args.deal_id);
      if (!dealId) return { error: "deal_id is required." };
      const stageName = text(args.stage);
      if (!stageName) return { error: "stage is required." };
      const overview = await repos.overview(actor);
      const deal = overview.deals.find((candidate) => candidate.id === dealId);
      if (!deal) return { error: `No deal with id "${dealId}". Call crm_overview to list deals.` };
      const pipeline = overview.pipelines.find((candidate) => candidate.id === deal.pipelineId);
      if (!pipeline) return { error: "The deal's pipeline no longer exists." };
      const stage = resolveStageByName(pipeline, stageName);
      if ("error" in stage) return stage;
      const moved = await repos.moveDeal(actor, dealId, stage.id);
      return { moved: true, deal: dealSummary(moved, overview.pipelines) };
    }
    return undefined;
  } catch (error) {
    if (error instanceof IsolationError) return { error: error.message };
    throw error;
  }
}

export const CRM_WEBHOOK_EVENTS = [
  "contact.created",
  "contact.updated",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
] as const;

export type CrmWebhookEvent = (typeof CRM_WEBHOOK_EVENTS)[number];

export type CrmWebhookEmitter = (
  workspaceId: string,
  type: CrmWebhookEvent,
  resourceId: string,
  payload: unknown,
) => Promise<void>;

/**
 * Writes the outbox row a delivery job later drains. Lives here rather than in
 * the API so the worker — which executes every run when WAKEUP_DRIVER=graphile
 * — can emit the same events an agent's CRM tool calls produce.
 */
export function createCrmWebhookEmitter(
  prisma: Pick<PrismaClient, "crmWebhookEndpoint" | "crmWebhookEvent">,
): CrmWebhookEmitter {
  return async (workspaceId, type, resourceId, payload) => {
    try {
      const endpoints = await prisma.crmWebhookEndpoint.findMany({
        where: { workspaceId, enabled: true },
        select: { id: true, events: true },
      });
      const matching = endpoints.filter(
        ({ events }) => Array.isArray(events) && events.includes(type),
      );
      if (!matching.length) return;
      await prisma.crmWebhookEvent.create({
        data: {
          workspaceId,
          type,
          resourceId,
          payload: payload as never,
          deliveries: { create: matching.map(({ id: endpointId }) => ({ endpointId })) },
        },
      });
    } catch (error) {
      // CRM writes remain authoritative if the outbox is temporarily unavailable.
      // The caller must never retry an already-applied mutation because event capture failed.
      console.error("crm webhook event capture", error);
    }
  };
}
