import type { CrmContact, CrmDeal, CrmOverview, CrmStage } from "@rakazo/contracts";

/**
 * The CRM wears Manor's palette: violet stepped through lightness for stage
 * progression, and the classic won/lost pair for money. Mirrors the web CRM's
 * theme.ts — each app keeps its own copy, the way lib/computer.ts does.
 */
const STAGE_SCALE = ["#6D28D9", "#7C3AED", "#8B5CF6", "#A855F7", "#C084FC", "#D8B4FE"];

export function stageColor(position: number): string {
  return STAGE_SCALE[Math.min(position, STAGE_SCALE.length - 1)] ?? STAGE_SCALE[0]!;
}

export const STATUS_COLORS = {
  open: "#A855F7",
  won: "#4ADE80",
  lost: "#F87171",
} as const;

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Compact form for chart labels: $1.2M, $45k. */
export function formatMoneyShort(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}

export const ALL_PIPELINES = "__all__";

export type CrmScope = {
  stages: CrmStage[];
  deals: CrmDeal[];
};

/** The deals and stages a pipeline filter leaves in play. */
export function scopeOverview(overview: CrmOverview, pipelineId: string): CrmScope {
  const pipelines =
    pipelineId === ALL_PIPELINES
      ? overview.pipelines
      : overview.pipelines.filter((pipeline) => pipeline.id === pipelineId);
  const stages = pipelines.flatMap((pipeline) => pipeline.stages);
  const stageIds = new Set(stages.map((stage) => stage.id));
  return { stages, deals: overview.deals.filter((deal) => stageIds.has(deal.stageId)) };
}

export type CrmSummary = {
  totalValue: number;
  wonValue: number;
  openValue: number;
  avgDeal: number;
  openCount: number;
  wonCount: number;
  lostCount: number;
  dealCount: number;
};

/** The numbers a service business checks every morning. */
export function summarize(scope: CrmScope): CrmSummary {
  const open = scope.deals.filter((deal) => deal.status === "open");
  const won = scope.deals.filter((deal) => deal.status === "won");
  const lost = scope.deals.filter((deal) => deal.status === "lost");
  const total = (deals: CrmDeal[]) => deals.reduce((sum, deal) => sum + deal.value, 0);
  const totalValue = total(scope.deals);
  return {
    totalValue,
    wonValue: total(won),
    openValue: total(open),
    avgDeal: scope.deals.length ? Math.round(totalValue / scope.deals.length) : 0,
    openCount: open.length,
    wonCount: won.length,
    lostCount: lost.length,
    dealCount: scope.deals.length,
  };
}

export type StageBreakdown = {
  id: string;
  name: string;
  color: string;
  count: number;
  value: number;
  /** Share of the largest stage, for bar widths. Always 0..1. */
  share: number;
};

export function stageBreakdown(scope: CrmScope): StageBreakdown[] {
  const rows = scope.stages.map((stage) => {
    const deals = scope.deals.filter((deal) => deal.stageId === stage.id);
    return {
      id: stage.id,
      name: stage.name,
      color: stage.color ?? stageColor(stage.position),
      count: deals.length,
      value: deals.reduce((sum, deal) => sum + deal.value, 0),
      share: 0,
    };
  });
  const max = Math.max(...rows.map((row) => row.value), 1);
  return rows.map((row) => ({ ...row, share: row.value / max }));
}

export function contactName(contact: Pick<CrmContact, "firstName" | "lastName">): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

/** Matches on the fields someone would actually search a contact by. */
export function matchesContact(contact: CrmContact, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    contactName(contact),
    contact.email ?? "",
    contact.phone ?? "",
    contact.company ?? "",
    ...contact.tags.map((tag) => tag.name),
  ].some((field) => field.toLowerCase().includes(needle));
}

/**
 * Deal values are typed on a phone keypad, so they arrive as whatever the user
 * pressed. The contract wants a non-negative integer.
 */
export function parseDealValue(input: string): number {
  const digits = input.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  return Math.min(Number.parseInt(digits, 10), 1_000_000_000);
}
