import type { CrmContact, CrmOverview } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  ALL_PIPELINES,
  contactName,
  formatMoney,
  formatMoneyShort,
  matchesContact,
  parseDealValue,
  scopeOverview,
  stageBreakdown,
  stageColor,
  summarize,
} from "./crm.js";

const overview: CrmOverview = {
  pipelines: [
    {
      id: "pipe_1",
      name: "Sales",
      position: 0,
      stages: [
        { id: "stage_1", pipelineId: "pipe_1", name: "Lead", position: 0, color: null },
        { id: "stage_2", pipelineId: "pipe_1", name: "Won", position: 1, color: null },
      ],
    },
    {
      id: "pipe_2",
      name: "Renewals",
      position: 1,
      stages: [{ id: "stage_3", pipelineId: "pipe_2", name: "Due", position: 0, color: null }],
    },
  ],
  deals: [
    {
      id: "deal_1",
      pipelineId: "pipe_1",
      stageId: "stage_1",
      contactId: null,
      title: "Roof",
      value: 1000,
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "deal_2",
      pipelineId: "pipe_1",
      stageId: "stage_2",
      contactId: null,
      title: "Deck",
      value: 3000,
      status: "won",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "deal_3",
      pipelineId: "pipe_2",
      stageId: "stage_3",
      contactId: null,
      title: "Renewal",
      value: 500,
      status: "lost",
      createdAt: "2026-01-03T00:00:00.000Z",
    },
  ],
  contacts: [],
  tags: [],
};

describe("scopeOverview", () => {
  it("keeps every pipeline's deals when nothing is filtered", () => {
    const scope = scopeOverview(overview, ALL_PIPELINES);
    expect(scope.deals).toHaveLength(3);
    expect(scope.stages).toHaveLength(3);
  });

  it("drops deals belonging to the pipelines that were filtered out", () => {
    const scope = scopeOverview(overview, "pipe_1");
    expect(scope.deals.map((deal) => deal.id)).toEqual(["deal_1", "deal_2"]);
  });

  it("returns nothing for a pipeline that no longer exists", () => {
    expect(scopeOverview(overview, "pipe_gone").deals).toEqual([]);
  });
});

describe("summarize", () => {
  it("splits value by status and averages across every deal", () => {
    const summary = summarize(scopeOverview(overview, ALL_PIPELINES));
    expect(summary).toMatchObject({
      totalValue: 4500,
      wonValue: 3000,
      openValue: 1000,
      openCount: 1,
      wonCount: 1,
      lostCount: 1,
      dealCount: 3,
    });
    expect(summary.avgDeal).toBe(1500);
  });

  it("does not divide by zero on an empty board", () => {
    expect(summarize({ stages: [], deals: [] }).avgDeal).toBe(0);
  });
});

describe("stageBreakdown", () => {
  it("scales each bar against the fullest stage", () => {
    const rows = stageBreakdown(scopeOverview(overview, "pipe_1"));
    expect(rows.map((row) => row.share)).toEqual([1000 / 3000, 1]);
  });

  it("keeps empty stages visible with a zero share", () => {
    const rows = stageBreakdown({ stages: overview.pipelines[0]!.stages, deals: [] });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.share === 0 && row.count === 0)).toBe(true);
  });

  it("falls back to the violet scale when a stage has no colour", () => {
    expect(stageBreakdown(scopeOverview(overview, "pipe_1"))[0]!.color).toBe(stageColor(0));
  });
});

describe("money formatting", () => {
  it("writes whole dollars", () => {
    expect(formatMoney(1500)).toBe("$1,500");
  });

  it("compacts thousands and millions for tight labels", () => {
    expect(formatMoneyShort(450)).toBe("$450");
    expect(formatMoneyShort(45_000)).toBe("$45k");
    expect(formatMoneyShort(1_200_000)).toBe("$1.2M");
  });
});

describe("contacts", () => {
  const contact: CrmContact = {
    id: "contact_1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "555-0100",
    company: "Analytical Engines",
    notes: null,
    status: "active",
    tags: [{ id: "tag_1", name: "VIP", color: null }],
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("joins a name without stranding a space when there is no surname", () => {
    expect(contactName(contact)).toBe("Ada Lovelace");
    expect(contactName({ firstName: "Cher", lastName: "" })).toBe("Cher");
  });

  it("searches the fields someone would actually type", () => {
    for (const query of ["ada", "LOVELACE", "example.com", "555", "engines", "vip"]) {
      expect(matchesContact(contact, query)).toBe(true);
    }
    expect(matchesContact(contact, "babbage")).toBe(false);
  });

  it("matches everything on an empty query", () => {
    expect(matchesContact(contact, "   ")).toBe(true);
  });
});

describe("parseDealValue", () => {
  it("strips whatever the keypad let through", () => {
    expect(parseDealValue("$1,250")).toBe(1250);
    expect(parseDealValue("")).toBe(0);
    expect(parseDealValue("abc")).toBe(0);
  });

  it("clamps to the ceiling the contract accepts", () => {
    expect(parseDealValue("9999999999")).toBe(1_000_000_000);
  });
});
