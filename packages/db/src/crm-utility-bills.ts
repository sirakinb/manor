import type { PrismaClient } from "./client.js";
import { normStreetAddr, upsertCityUtilityBill } from "./utility-city-bills.js";

export type CrmUtilityField = { id: string; label: string };

export type CrmUtilityBillExtract =
  | {
      ok: true;
      serviceAddress: string;
      billingMonth: string;
      currentCharges: number;
      dueDate: string;
    }
  | { ok: false; reason: CrmUtilitySkipReason };

export type CrmUtilitySkipReason =
  | "not_utility_module"
  | "no_address_field"
  | "no_amount_field"
  | "missing_address"
  | "missing_amount"
  | "missing_due_date"
  | "bad_month";

export type CrmUtilitySyncResult = {
  modules: number;
  scanned: number;
  applied: number;
  skipped: number;
  waiting: number;
  notice: string;
};

export type CrmDueDateFillResult = {
  matched: number;
  waiting: number;
  ambiguous: number;
  notice: string;
};

const MONTH_NAMES: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const BALANCE_LABEL = /balance|account\s*total|running|past\s*due|amount\s*due|total\s*due/i;
const STRICT_AMOUNT_LABEL =
  /current\s*charges|city\s*(bill|charges)|monthly\s*(bill|charge|amount)|this\s*month|water\s*bill/i;
const LOOSE_AMOUNT_LABEL = /^(amount|charges|bill)$/i;
const ADDRESS_LABEL = /service\s*address|\baddress\b|\bstreet\b|property\s*address|^property$/i;
const MONTH_LABEL = /billing\s*month|service\s*month|bill\s*month|\bperiod\b|^month$/i;
const DUE_LABEL = /due\s*date|^due$/i;

export function crmModuleLooksLikeUtilities(name: string): boolean {
  return /\b(utilit(?:y|ies)|water\s*bills?|city\s*bills?|philly\s*water|\bwrd\b)/i.test(name);
}

function amountScore(label: string, loose: boolean): number {
  const text = label.trim();
  if (!text || BALANCE_LABEL.test(text)) return -1;
  if (STRICT_AMOUNT_LABEL.test(text)) return 3;
  if (loose && LOOSE_AMOUNT_LABEL.test(text)) return 1;
  return 0;
}

function pickField(
  fields: readonly CrmUtilityField[],
  score: (label: string) => number,
): CrmUtilityField | null {
  let best: CrmUtilityField | null = null;
  let bestScore = 0;
  for (const field of fields) {
    const value = score(field.label);
    if (value > bestScore) {
      best = field;
      bestScore = value;
    }
  }
  return best;
}

export function crmModuleHasUtilityAmount(
  fields: readonly CrmUtilityField[],
  loose: boolean,
): boolean {
  return fields.some((field) => amountScore(field.label, loose) > 0);
}

function firstOfMonthIso(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export function parseCrmMoney(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseCrmServiceAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || !/\d/.test(text)) return null;
  return text;
}

export function resolveCrmBillingMonth(value: unknown, now: Date, dueDate?: string): string | null {
  if (value === null || value === undefined || value === "") {
    return dueDate ? `${dueDate.slice(0, 7)}-01` : firstOfMonthIso(now);
  }
  if (typeof value === "number" && Number.isFinite(value)) return null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return dueDate ? `${dueDate.slice(0, 7)}-01` : firstOfMonthIso(now);
  const iso = text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month < 1 || month > 12) return null;
    return `${iso[1]}-${iso[2]}-01`;
  }
  const named = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (named) {
    const month = MONTH_NAMES[named[1]!.toLowerCase()];
    if (month === undefined) return null;
    return firstOfMonthIso(new Date(Date.UTC(Number(named[2]), month, 1)));
  }
  return null;
}

export function resolveCrmDueDate(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!named) return undefined;
  const month = MONTH_NAMES[named[1]!.toLowerCase()];
  const day = Number(named[2]);
  if (month === undefined || day < 1 || day > 31) return undefined;
  return `${named[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function readValue(values: Record<string, unknown>, field: CrmUtilityField | null): unknown {
  if (!field) return undefined;
  return values[field.id] ?? values[field.label];
}

export function extractCrmUtilityBill(input: {
  moduleName: string;
  fields: readonly CrmUtilityField[];
  values: Record<string, unknown>;
  now: Date;
}): CrmUtilityBillExtract {
  const loose = crmModuleLooksLikeUtilities(input.moduleName);
  const hasAmount = crmModuleHasUtilityAmount(input.fields, loose);
  if (!loose && !hasAmount) return { ok: false, reason: "not_utility_module" };

  const addressField = pickField(input.fields, (label) => (ADDRESS_LABEL.test(label) ? 1 : 0));
  const amountField = pickField(input.fields, (label) => amountScore(label, loose));
  const monthField = pickField(input.fields, (label) => (MONTH_LABEL.test(label) ? 1 : 0));
  const dueField = pickField(input.fields, (label) =>
    DUE_LABEL.test(label) && !BALANCE_LABEL.test(label) ? 1 : 0,
  );

  if (!addressField) return { ok: false, reason: "no_address_field" };
  if (!amountField) return { ok: false, reason: "no_amount_field" };

  const serviceAddress = parseCrmServiceAddress(readValue(input.values, addressField));
  if (!serviceAddress) return { ok: false, reason: "missing_address" };
  const currentCharges = parseCrmMoney(readValue(input.values, amountField));
  if (currentCharges === null) return { ok: false, reason: "missing_amount" };
  const dueDate = resolveCrmDueDate(readValue(input.values, dueField));
  if (!dueDate) return { ok: false, reason: "missing_due_date" };
  const billingMonth = resolveCrmBillingMonth(
    readValue(input.values, monthField),
    input.now,
    dueDate,
  );
  if (!billingMonth) return { ok: false, reason: "bad_month" };
  return {
    ok: true,
    serviceAddress,
    billingMonth,
    currentCharges,
    dueDate,
  };
}

export type MatchedCrmUtilityBill = Extract<CrmUtilityBillExtract, { ok: true }>;

export function crmDueDateKey(address: string, dueDate: string): string {
  return `${normStreetAddr(address)}|${dueDate}`;
}

/** One CRM amount per address+due date. Two different amounts for the same due date stay unmatched. */
export function indexCrmBillsByDueDate(
  bills: readonly MatchedCrmUtilityBill[],
): Map<string, MatchedCrmUtilityBill | "ambiguous"> {
  const index = new Map<string, MatchedCrmUtilityBill | "ambiguous">();
  for (const bill of bills) {
    if (!bill.dueDate) continue;
    const key = crmDueDateKey(bill.serviceAddress, bill.dueDate);
    const existing = index.get(key);
    if (!existing) {
      index.set(key, bill);
      continue;
    }
    if (existing === "ambiguous") continue;
    if (existing.currentCharges !== bill.currentCharges) index.set(key, "ambiguous");
  }
  return index;
}

export function matchCrmBillForNotice(
  index: Map<string, MatchedCrmUtilityBill | "ambiguous">,
  serviceAddress: string,
  dueDate: string,
): MatchedCrmUtilityBill | "ambiguous" | null {
  return index.get(crmDueDateKey(serviceAddress, dueDate)) ?? null;
}

export function crmUtilitySyncNotice(result: Omit<CrmUtilitySyncResult, "notice">): string {
  if (result.modules === 0) {
    return "No CRM water bills sheet found. Add a module named Water bills (or Utilities) with Address, Due date, and Current charges. Do not use Account balance.";
  }
  if (result.scanned === 0) {
    return "The CRM water bills sheet has no rows yet.";
  }
  if (result.applied === 0 && result.waiting > 0) {
    return `Gmail has ${result.waiting} notice(s) still waiting on a matching CRM due date.`;
  }
  if (result.applied === 0) {
    return `Read ${result.scanned} CRM row(s); none had a street address, due date, and Current charges.`;
  }
  const copied = `Matched ${result.applied} city bill amount(s) from CRM by address and due date.`;
  if (result.waiting === 0 && result.skipped === 0) return copied;
  const waiting =
    result.waiting > 0
      ? ` Waiting on ${result.waiting} Gmail notice(s) until the CRM sheet has that due date.`
      : "";
  return `${copied}${waiting}`;
}

export function crmDueDateFillNotice(result: Omit<CrmDueDateFillResult, "notice">): string {
  if (result.matched === 0 && result.waiting === 0) {
    return "No Gmail water notices are waiting on a CRM due date.";
  }
  const parts: string[] = [];
  if (result.matched > 0) {
    parts.push(`Matched ${result.matched} Gmail notice(s) to CRM current charges by due date.`);
  }
  if (result.waiting > 0) {
    parts.push(
      `Waiting on ${result.waiting} notice(s) until the CRM water bills sheet has that due date.`,
    );
  }
  if (result.ambiguous > 0) {
    parts.push(
      `Skipped ${result.ambiguous} address/due date pair(s) with more than one CRM amount.`,
    );
  }
  return parts.join(" ");
}

async function workspaceIdForOrg(
  prisma: PrismaClient,
  organizationId: string,
  knownWorkspaceId?: string,
): Promise<string | null> {
  if (knownWorkspaceId) return knownWorkspaceId;
  const workspace = await prisma.workspace.findUnique({
    where: { organizationId },
    select: { id: true },
  });
  return workspace?.id ?? null;
}

async function loadMatchedCrmUtilityBills(
  prisma: PrismaClient,
  input: { organizationId: string; now: Date },
): Promise<{ modules: number; scanned: number; bills: MatchedCrmUtilityBill[] }> {
  const modules = await prisma.crmModule.findMany({
    where: { organizationId: input.organizationId },
    include: { fields: true },
    orderBy: { position: "asc" },
  });
  const eligible = modules.filter((module) => {
    const fields = module.fields.map((field) => ({ id: field.id, label: field.label }));
    return crmModuleLooksLikeUtilities(module.name) || crmModuleHasUtilityAmount(fields, false);
  });
  const bills: MatchedCrmUtilityBill[] = [];
  let scanned = 0;
  for (const module of eligible) {
    const fields = module.fields.map((field) => ({ id: field.id, label: field.label }));
    const records = await prisma.crmModuleRecord.findMany({
      where: { organizationId: input.organizationId, moduleId: module.id },
    });
    for (const record of records) {
      scanned += 1;
      const values =
        record.values && typeof record.values === "object" && !Array.isArray(record.values)
          ? (record.values as Record<string, unknown>)
          : {};
      const extracted = extractCrmUtilityBill({
        moduleName: module.name,
        fields,
        values,
        now: input.now,
      });
      if (extracted.ok) bills.push(extracted);
    }
  }
  return { modules: eligible.length, scanned, bills };
}

function dayIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Copy CRM current charges onto Gmail WRD notices that share the same
 * property and due date. Notices without a CRM row stay waiting for the
 * next daily run.
 */
export async function fillWaterBillsFromCrmByDueDate(
  prisma: PrismaClient,
  input: { organizationId: string; workspaceId: string; now?: Date },
): Promise<CrmDueDateFillResult> {
  const loaded = await loadMatchedCrmUtilityBills(prisma, {
    organizationId: input.organizationId,
    now: input.now ?? new Date(),
  });
  const index = indexCrmBillsByDueDate(loaded.bills);
  const pending = await prisma.workspaceWaterBill.findMany({
    where: {
      workspaceId: input.workspaceId,
      utility: "water",
      currentCharges: null,
      dueDate: { not: null },
      serviceAddressNorm: { not: null },
    },
  });
  let matched = 0;
  let waiting = 0;
  let ambiguous = 0;
  for (const row of pending) {
    if (!row.dueDate || !row.serviceAddressNorm) continue;
    const hit = matchCrmBillForNotice(
      index,
      row.serviceAddress ?? row.serviceAddressNorm,
      dayIso(row.dueDate),
    );
    if (hit === "ambiguous") {
      ambiguous += 1;
      continue;
    }
    if (!hit) {
      waiting += 1;
      continue;
    }
    await prisma.workspaceWaterBill.update({
      where: { id: row.id },
      data: {
        currentCharges: hit.currentCharges,
        parseStatus: "parsed",
        parseNotes: "CRM current charges matched by due date",
        sourceKind: "crm",
      },
    });
    matched += 1;
  }
  const summary = { matched, waiting, ambiguous };
  return { ...summary, notice: crmDueDateFillNotice(summary) };
}

export async function applyCrmUtilityBillRecord(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    workspaceId?: string;
    moduleName: string;
    fields: readonly CrmUtilityField[];
    values: Record<string, unknown>;
    now?: Date;
  },
): Promise<"applied" | "skipped"> {
  const extracted = extractCrmUtilityBill({
    moduleName: input.moduleName,
    fields: input.fields,
    values: input.values,
    now: input.now ?? new Date(),
  });
  if (!extracted.ok) return "skipped";
  const workspaceId = await workspaceIdForOrg(prisma, input.organizationId, input.workspaceId);
  if (!workspaceId) return "skipped";
  await upsertCityUtilityBill(prisma, {
    workspaceId,
    serviceAddress: extracted.serviceAddress,
    billingMonth: extracted.billingMonth,
    currentCharges: extracted.currentCharges,
    dueDate: extracted.dueDate,
    sourceNote: `CRM ${input.moduleName}`,
    sourceKind: "crm",
  });
  return "applied";
}

export async function syncWaterBillsFromCrm(
  prisma: PrismaClient,
  input: { organizationId: string; workspaceId: string; now?: Date },
): Promise<CrmUtilitySyncResult> {
  const now = input.now ?? new Date();
  const modules = await prisma.crmModule.findMany({
    where: { organizationId: input.organizationId },
    include: { fields: true },
    orderBy: { position: "asc" },
  });
  const eligible = modules.filter((module) => {
    const fields = module.fields.map((field) => ({ id: field.id, label: field.label }));
    return crmModuleLooksLikeUtilities(module.name) || crmModuleHasUtilityAmount(fields, false);
  });
  let scanned = 0;
  let applied = 0;
  let skipped = 0;
  for (const module of eligible) {
    const fields = module.fields.map((field) => ({ id: field.id, label: field.label }));
    const records = await prisma.crmModuleRecord.findMany({
      where: { organizationId: input.organizationId, moduleId: module.id },
    });
    for (const record of records) {
      scanned += 1;
      const values =
        record.values && typeof record.values === "object" && !Array.isArray(record.values)
          ? (record.values as Record<string, unknown>)
          : {};
      const result = await applyCrmUtilityBillRecord(prisma, {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        moduleName: module.name,
        fields,
        values,
        now,
      });
      if (result === "applied") applied += 1;
      else skipped += 1;
    }
  }
  const waiting = await prisma.workspaceWaterBill.count({
    where: {
      workspaceId: input.workspaceId,
      utility: "water",
      currentCharges: null,
      dueDate: { not: null },
    },
  });
  const summary = { modules: eligible.length, scanned, applied, skipped, waiting };
  return { ...summary, notice: crmUtilitySyncNotice(summary) };
}
