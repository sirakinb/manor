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
