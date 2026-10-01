import type { PrismaClient } from "./client.js";

/** Persist and display city bills as whole cents, never whole dollars. */
export function toMoneyCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Byte-identical enough to the Python/SQL street normalizer for matching bills. */
export function normStreetAddr(address: string): string {
  let text = address.replace(/[.,]/g, "").toLowerCase();
  const expansions: [RegExp, string][] = [
    [/\bst\b/g, "street"],
    [/\bave\b/g, "avenue"],
    [/\brd\b/g, "road"],
    [/\bdr\b/g, "drive"],
    [/\bn\b/g, "north"],
    [/\bs\b/g, "south"],
    [/\be\b/g, "east"],
    [/\bw\b/g, "west"],
  ];
  for (const [pattern, replacement] of expansions) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
}

const DIRECTIONS = new Set(["north", "south", "east", "west"]);
const STREET_TYPES = new Set([
  "street",
  "avenue",
  "road",
  "drive",
  "lane",
  "court",
  "place",
  "boulevard",
  "terrace",
  "way",
]);

/**
 * Whether two normalized addresses are the same place written differently: the same house
 * number and street name, where a missing direction or street type is fine but two
 * different ones never match. "330 simpson street" matches "330 north simpson street";
 * north never matches south, and street never matches place.
 */
export function sameStreetAddr(left: string, right: string): boolean {
  const parts = (norm: string) => {
    const words = norm.split(" ");
    return {
      directions: words.filter((word) => DIRECTIONS.has(word)).join(" "),
      types: words.filter((word) => STREET_TYPES.has(word)).join(" "),
      rest: words.filter((word) => !DIRECTIONS.has(word) && !STREET_TYPES.has(word)).join(" "),
    };
  };
  const a = parts(left);
  const b = parts(right);
  const compatible = (x: string, y: string) => !x || !y || x === y;
  return (
    Boolean(a.rest) &&
    a.rest === b.rest &&
    compatible(a.directions, b.directions) &&
    compatible(a.types, b.types)
  );
}

const houseNumber = (norm: string): string | null => /^\d+[a-z]?\b/.exec(norm)?.[0] ?? null;
const numbersIn = (norm: string): string[] => norm.match(/\b\d+[a-z]?\b/g) ?? [];

export type UtilityBillMatch = "address" | "variation" | "balance_due_date";

/**
 * Attach bills to tracked properties: an exact address or saved spelling first, then the
 * same house number and street name when only one property has it, then, for a bill with
 * the same house number, the same total amount due and due date as a bill already
 * attached to exactly one property.
 */
export function matchBillsToProperties<
  Bill extends {
    utility: string;
    serviceAddressNorm: string | null;
    dueDate: Date | null;
    accountBalance: number | null;
    amountDue: number | null;
  },
  Property extends { id: string; utility: string; addressNorms: readonly string[] },
>(
  bills: readonly Bill[],
  properties: readonly Property[],
): Map<Bill, { property: Property; matchedBy: UtilityBillMatch }> {
  const matches = new Map<Bill, { property: Property; matchedBy: UtilityBillMatch }>();
  const only = <T>(rows: T[]): T | undefined => (rows.length === 1 ? rows[0] : undefined);
  for (const bill of bills) {
    const norm = bill.serviceAddressNorm;
    if (!norm) continue;
    const candidates = properties.filter((property) => property.utility === bill.utility);
    const exact = candidates.find((property) => property.addressNorms.includes(norm));
    if (exact) {
      matches.set(bill, { property: exact, matchedBy: "address" });
      continue;
    }
    const variation = only(
      candidates.filter((property) =>
        property.addressNorms.some((candidate) => sameStreetAddr(candidate, norm)),
      ),
    );
    if (variation) matches.set(bill, { property: variation, matchedBy: "variation" });
  }
  const balanceKey = (bill: Bill): string | null => {
    const total = bill.accountBalance ?? bill.amountDue;
    if (total === null || !bill.dueDate) return null;
    return `${bill.utility}|${bill.dueDate.toISOString().slice(0, 10)}|${Math.round(total * 100)}`;
  };
  const propertiesByBalance = new Map<string, Set<Property>>();
  for (const [bill, match] of matches) {
    const key = balanceKey(bill);
    if (!key) continue;
    const set = propertiesByBalance.get(key) ?? new Set<Property>();
    set.add(match.property);
    propertiesByBalance.set(key, set);
  }
  for (const bill of bills) {
    if (matches.has(bill) || !bill.serviceAddressNorm) continue;
    const key = balanceKey(bill);
    const found = key ? propertiesByBalance.get(key) : undefined;
    const property = found && found.size === 1 ? [...found][0] : undefined;
    const numbers = numbersIn(bill.serviceAddressNorm);
    // The property's house number somewhere in the bill's address keeps a coincidental
    // balance at another address from matching.
    if (
      property &&
      property.addressNorms.some((candidate) => {
        const number = houseNumber(candidate);
        return number !== null && numbers.includes(number);
      })
    ) {
      matches.set(bill, { property, matchedBy: "balance_due_date" });
    }
  }
  return matches;
}

export function firstOfMonthUtc(dayValue: string): Date {
  const [year, month] = dayValue.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, 1));
}

export function parseDueDateUtc(dueDate: string | undefined): Date | undefined {
  if (!dueDate) return undefined;
  return new Date(
    Date.UTC(
      Number(dueDate.slice(0, 4)),
      Number(dueDate.slice(5, 7)) - 1,
      Number(dueDate.slice(8, 10)),
    ),
  );
}

function isSyntheticBillId(gmailMessageId: string): boolean {
  return gmailMessageId.startsWith("city-bill:") || gmailMessageId.startsWith("crm-bill:");
}

export type CityBillSourceKind = "city_bill" | "crm";

export type UpsertCityUtilityBillInput = {
  workspaceId: string;
  serviceAddress: string;
  billingMonth: string;
  currentCharges: number;
  dueDate?: string;
  sourceNote?: string;
  sourceKind: CityBillSourceKind;
};

export type UpsertCityUtilityBillResult = { id: string; created: boolean };

/**
 * Write the city's current charges for one address and month. Prefers an
 * existing Gmail notice row so later WRD polls keep the same bill id.
 */
export async function upsertCityUtilityBill(
  prisma: PrismaClient,
  input: UpsertCityUtilityBillInput,
): Promise<UpsertCityUtilityBillResult> {
  if (!Number.isFinite(input.currentCharges) || input.currentCharges < 0) {
    throw new RangeError("currentCharges must be the city's monthly current charges");
  }
  const currentCharges = toMoneyCents(input.currentCharges);
  const addressNorm = normStreetAddr(input.serviceAddress);
  const billingMonth = firstOfMonthUtc(input.billingMonth);
  const due = parseDueDateUtc(input.dueDate);
  const byDue =
    due === undefined
      ? []
      : await prisma.workspaceWaterBill.findMany({
          where: {
            workspaceId: input.workspaceId,
            utility: "water",
            serviceAddressNorm: addressNorm,
            dueDate: due,
          },
          orderBy: { createdAt: "desc" },
        });
  const byMonth = await prisma.workspaceWaterBill.findMany({
    where: {
      workspaceId: input.workspaceId,
      utility: "water",
      serviceAddressNorm: addressNorm,
      billingMonth,
    },
    orderBy: { createdAt: "desc" },
  });
  const matches = byDue.length > 0 ? byDue : byMonth;
  const existing = matches.find((row) => !isSyntheticBillId(row.gmailMessageId)) ?? matches[0];
  const note = input.sourceNote?.trim() || "city bill current charges";
  if (existing) {
    await prisma.workspaceWaterBill.update({
      where: { id: existing.id },
      data: {
        currentCharges,
        dueDate: due === undefined ? existing.dueDate : due,
        billingMonth: existing.billingMonth ?? billingMonth,
        parseStatus: "parsed",
        parseNotes: note,
        serviceAddress: existing.serviceAddress ?? input.serviceAddress,
        serviceAddressNorm: addressNorm,
        sourceKind: input.sourceKind,
      },
    });
    return { id: existing.id, created: false };
  }
  const monthKey = billingMonth.toISOString().slice(0, 7);
  const prefix = input.sourceKind === "crm" ? "crm-bill" : "city-bill";
  const created = await prisma.workspaceWaterBill.create({
    data: {
      workspaceId: input.workspaceId,
      utility: "water",
      gmailMessageId: `${prefix}:${addressNorm}:${monthKey}`,
      billIndex: 0,
      serviceAddress: input.serviceAddress,
      serviceAddressNorm: addressNorm,
      currentCharges,
      dueDate: due ?? null,
      billingMonth,
      parseStatus: "parsed",
      parseNotes: note,
      sourceKind: input.sourceKind,
    },
  });
  return { id: created.id, created: true };
}
