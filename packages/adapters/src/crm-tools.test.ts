import type { CrmContact, CrmDeal, CrmOverview, CrmPipeline } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  type CrmRepos,
  crmAgentTools,
  executeCrmTool,
  resolvePipelineByName,
  resolveStageByName,
  summarizeOverview,
} from "./crm-tools.js";

const SCOPE = { userId: "user-1", workspaceId: "ws-1" };

function makeFakeRepos() {
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;
  const pipelines: CrmPipeline[] = [
    {
      id: "pipe-1",
      name: "Sales",
      position: 0,
      stages: [
        { id: "stage-1", pipelineId: "pipe-1", name: "Lead", position: 0, color: null },
        { id: "stage-2", pipelineId: "pipe-1", name: "Proposal", position: 1, color: null },
        { id: "stage-3", pipelineId: "pipe-1", name: "Closed", position: 2, color: null },
      ],
    },
  ];
  const contacts: CrmContact[] = [];
  const deals: CrmDeal[] = [];
  const tags: { id: string; name: string; color: string | null }[] = [];

  const overview = async (): Promise<CrmOverview> => ({
    pipelines,
    deals: [...deals],
    contacts: [...contacts],
    tags: [...tags],
  });

  const repos = {
    overview,
    seedDefaultPipeline: overview,
    async searchContacts(_actor: unknown, query: string) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      return contacts.filter((contact) =>
        terms.every((term) =>
          [contact.firstName, contact.lastName, contact.company ?? "", contact.email ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(term),
        ),
      );
    },
    async createTag(_actor: unknown, input: { name: string; color?: string }) {
      const existing = tags.find((tag) => tag.name === input.name);
      if (existing) return existing;
      const tag = { id: id("tag"), name: input.name, color: input.color ?? null };
      tags.push(tag);
      return tag;
    },
    async createContact(
      _actor: unknown,
      input: {
        firstName: string;
        lastName: string;
        email?: string;
        phone?: string;
        company?: string;
        notes?: string;
        tagIds?: string[];
      },
    ) {
      const contact: CrmContact = {
        id: id("contact"),
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        company: input.company ?? null,
        notes: input.notes ?? null,
        status: "active",
        tags: tags.filter((tag) => input.tagIds?.includes(tag.id)),
        createdAt: new Date().toISOString(),
      };
      contacts.push(contact);
      return contact;
    },
    async updateContact(_actor: unknown, input: { contactId: string } & Record<string, unknown>) {
      const contact = contacts.find((candidate) => candidate.id === input.contactId);
      if (!contact) throw new Error("missing contact");
      if (typeof input.company === "string") contact.company = input.company;
      if (typeof input.notes === "string") contact.notes = input.notes;
      if (typeof input.firstName === "string") contact.firstName = input.firstName;
      return contact;
    },
    async createDeal(
      _actor: unknown,
      input: {
        pipelineId: string;
        stageId: string;
        title: string;
        value: number;
        contactId?: string;
      },
    ) {
      const deal: CrmDeal = {
        id: id("deal"),
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        contactId: input.contactId ?? null,
        title: input.title,
        value: input.value,
        status: "open",
        createdAt: new Date().toISOString(),
      };
      deals.push(deal);
      return deal;
    },
    async updateDeal(
      _actor: unknown,
      input: { dealId: string; value?: number; status?: "open" | "won" | "lost" },
    ) {
      const deal = deals.find((candidate) => candidate.id === input.dealId);
      if (!deal) throw new Error("missing deal");
      if (input.value !== undefined) deal.value = input.value;
      if (input.status) deal.status = input.status;
      return deal;
    },
    async moveDeal(_actor: unknown, dealId: string, stageId: string) {
      const deal = deals.find((candidate) => candidate.id === dealId);
      if (!deal) throw new Error("missing deal");
      deal.stageId = stageId;
      return deal;
    },
  };
  return { repos: repos as unknown as CrmRepos, state: { pipelines, contacts, deals, tags } };
}

describe("crm tool declarations", () => {
  it("declares the crm_ tools with object schemas", () => {
    expect(crmAgentTools.map((tool) => tool.name)).toEqual([
      "crm_overview",
      "crm_find_contacts",
      "crm_upsert_contact",
      "crm_create_deal",
      "crm_update_deal",
      "crm_move_deal",
      "crm_list_modules",
      "crm_create_module",
      "crm_list_records",
      "crm_upsert_record",
      "crm_delete_record",
    ]);
    for (const tool of crmAgentTools) expect(tool.inputSchema.type).toBe("object");
  });
});

describe("name resolution", () => {
  const pipelines: CrmPipeline[] = [
    { id: "a", name: "Sales", position: 0, stages: [] },
    {
      id: "b",
      name: "Onboarding",
      position: 1,
      stages: [{ id: "s1", pipelineId: "b", name: "Kickoff", position: 0, color: null }],
    },
  ];
  it("defaults to the first pipeline and matches case-insensitively", () => {
    expect(resolvePipelineByName(pipelines, undefined)).toBe(pipelines[0]);
    expect(resolvePipelineByName(pipelines, "onboarding")).toBe(pipelines[1]);
    expect(resolvePipelineByName(pipelines, "Billing")).toMatchObject({
      error: expect.stringContaining("Sales, Onboarding"),
    });
    expect(resolvePipelineByName([], undefined)).toMatchObject({ error: expect.any(String) });
  });
  it("resolves stages by name with a helpful error", () => {
    const pipeline = pipelines[1]!;
    expect(resolveStageByName(pipeline, "KICKOFF")).toBe(pipeline.stages[0]);
    expect(resolveStageByName(pipeline, undefined)).toBe(pipeline.stages[0]);
    expect(resolveStageByName(pipeline, "Done")).toMatchObject({
      error: expect.stringContaining("Kickoff"),
    });
  });
});

describe("executeCrmTool", () => {
  it("ignores non-CRM tool names", async () => {
    const { repos } = makeFakeRepos();
    expect(await executeCrmTool(repos, SCOPE, "shell", { command: "ls" })).toBeUndefined();
  });

  it("creates and updates contacts with tag names", async () => {
    const { repos } = makeFakeRepos();
    const created = (await executeCrmTool(repos, SCOPE, "crm_upsert_contact", {
      first_name: "John",
      last_name: "Smith",
      company: "Acme Plumbing",
      tags: ["lead", "plumbing"],
    })) as { created: boolean; contact: { id: string; name: string; tags: string[] } };
    expect(created.created).toBe(true);
    expect(created.contact.name).toBe("John Smith");
    expect(created.contact.tags).toEqual(["lead", "plumbing"]);

    const updated = (await executeCrmTool(repos, SCOPE, "crm_upsert_contact", {
      contact_id: created.contact.id,
      notes: "Prefers morning calls",
    })) as { updated: boolean; contact: { notes: string | null } };
    expect(updated.updated).toBe(true);
    expect(updated.contact.notes).toBe("Prefers morning calls");
  });

  it("requires first_name when creating", async () => {
    const { repos } = makeFakeRepos();
    expect(await executeCrmTool(repos, SCOPE, "crm_upsert_contact", {})).toMatchObject({
      error: expect.stringContaining("first_name"),
    });
  });

  it("creates a deal with default pipeline/stage and links a contact by name", async () => {
    const { repos, state } = makeFakeRepos();
    await executeCrmTool(repos, SCOPE, "crm_upsert_contact", {
      first_name: "John",
      last_name: "Smith",
      company: "Acme Plumbing",
    });
    const result = (await executeCrmTool(repos, SCOPE, "crm_create_deal", {
      title: "Water heater install",
      value: "$2,400",
      contact_name: "john acme",
    })) as { created: boolean; deal: { stage: string; value: number; contact_id: string | null } };
    expect(result.created).toBe(true);
    expect(result.deal.stage).toBe("Lead");
    expect(result.deal.value).toBe(2400);
    expect(result.deal.contact_id).toBe(state.contacts[0]!.id);
  });

  it("rejects unknown stages and ambiguous contact names", async () => {
    const { repos } = makeFakeRepos();
    await executeCrmTool(repos, SCOPE, "crm_upsert_contact", {
      first_name: "John",
      last_name: "A",
    });
    await executeCrmTool(repos, SCOPE, "crm_upsert_contact", {
      first_name: "John",
      last_name: "B",
    });
    expect(
      await executeCrmTool(repos, SCOPE, "crm_create_deal", {
        title: "x",
        value: 10,
        stage: "Imaginary",
      }),
    ).toMatchObject({ error: expect.stringContaining("Lead, Proposal, Closed") });
    expect(
      await executeCrmTool(repos, SCOPE, "crm_create_deal", {
        title: "x",
        value: 10,
        contact_name: "John",
      }),
    ).toMatchObject({ error: expect.stringContaining("Multiple contacts") });
  });

  it("moves deals between stages by name", async () => {
    const { repos, state } = makeFakeRepos();
    await executeCrmTool(repos, SCOPE, "crm_create_deal", { title: "Deal", value: 100 });
    const moved = (await executeCrmTool(repos, SCOPE, "crm_move_deal", {
      deal_id: state.deals[0]!.id,
      stage: "proposal",
    })) as { moved: boolean; deal: { stage: string } };
    expect(moved.moved).toBe(true);
    expect(state.deals[0]!.stageId).toBe("stage-2");
    expect(
      await executeCrmTool(repos, SCOPE, "crm_move_deal", { deal_id: "nope", stage: "Lead" }),
    ).toMatchObject({ error: expect.stringContaining("No deal") });
  });

  it("updates deal value and status", async () => {
    const { repos, state } = makeFakeRepos();
    await executeCrmTool(repos, SCOPE, "crm_create_deal", { title: "Deal", value: 100 });
    const result = (await executeCrmTool(repos, SCOPE, "crm_update_deal", {
      deal_id: state.deals[0]!.id,
      value: 2500,
      status: "won",
    })) as { updated: boolean; deal: { value: number; status: string } };
    expect(result.deal.value).toBe(2500);
    expect(result.deal.status).toBe("won");
    expect(
      await executeCrmTool(repos, SCOPE, "crm_update_deal", { deal_id: "d", value: -5 }),
    ).toMatchObject({ error: expect.stringContaining("non-negative") });
  });

  it("summarizes the board with per-stage rollups", async () => {
    const { repos } = makeFakeRepos();
    await executeCrmTool(repos, SCOPE, "crm_create_deal", { title: "A", value: 100 });
    await executeCrmTool(repos, SCOPE, "crm_create_deal", {
      title: "B",
      value: 250,
      stage: "Proposal",
    });
    const summary = summarizeOverview(
      await (repos.overview as CrmRepos["overview"])({ workspaceId: "ws-1" }),
    );
    expect(summary.totals).toMatchObject({ open_deals: 2, open_value: 350 });
    const lead = summary.pipelines[0]!.stages.find((stage) => stage.name === "Lead");
    const proposal = summary.pipelines[0]!.stages.find((stage) => stage.name === "Proposal");
    expect(lead).toMatchObject({ open_deals: 1, open_value: 100 });
    expect(proposal).toMatchObject({ open_deals: 1, open_value: 250 });
  });

  it("finds contacts with their deals attached", async () => {
    const { repos, state } = makeFakeRepos();
    await executeCrmTool(repos, SCOPE, "crm_upsert_contact", {
      first_name: "Maria",
      last_name: "Rodriguez",
      company: "Rodriguez HVAC",
    });
    await executeCrmTool(repos, SCOPE, "crm_create_deal", {
      title: "Duct cleaning",
      value: 900,
      contact_id: state.contacts[0]!.id,
    });
    const found = (await executeCrmTool(repos, SCOPE, "crm_find_contacts", {
      query: "rodriguez",
    })) as { contacts: { name: string; deals: { title: string }[] }[] };
    expect(found.contacts).toHaveLength(1);
    expect(found.contacts[0]!.deals[0]!.title).toBe("Duct cleaning");
  });
});
