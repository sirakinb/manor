/**
 * Which Buildium lease(s) carry a water bill for a given month.
 *
 * Today's Active lease id is the wrong target after a turnover: July's city
 * bill should post to the lease that covered July, not the tenant who moved
 * in later. Dated Past/Active terms win; an undated Active lease only fills
 * months no dated peer on the same unit already covers.
 */

export type UtilityLeaseTerm = {
  leaseId: number;
  unitNumber: string | null;
  status: string | null;
  leaseFrom: string | null;
  leaseTo: string | null;
  rent: number | null;
};

export type UtilityMonthLease = {
  leaseId: number;
  unitNumber: string | null;
  leaseTo: string | null;
  rent: number | null;
  chargeShare: number;
};

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** Split a city bill into whole cents that still add up to the original amount. */
export function splitChargeAmounts(total: number, shares: readonly number[]): number[] {
  const totalCents = Math.round(total * 100);
  const floors = shares.map((share) => Math.floor(totalCents * share + 1e-9));
  let leftover = totalCents - floors.reduce((sum, cents) => sum + cents, 0);
  const amounts = [...floors];
  for (let i = amounts.length - 1; i >= 0 && leftover !== 0; i--) {
    if ((shares[i] ?? 0) <= 0) continue;
    const step = leftover > 0 ? 1 : -1;
    amounts[i]! += step;
    leftover -= step;
  }
  return amounts.map((cents) => cents / 100);
}

function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function monthEnd(monthStart: Date): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
}

function datedOverlap(lease: UtilityLeaseTerm, start: Date, end: Date): boolean {
  const from = lease.leaseFrom ? parseDay(lease.leaseFrom) : null;
  const to = lease.leaseTo ? parseDay(lease.leaseTo) : null;
  if (from && to) return from.getTime() <= end.getTime() && to.getTime() >= start.getTime();
  if (from && !to) return from.getTime() <= end.getTime();
  if (!from && to) {
    if (lease.status === "Active") return to.getTime() >= start.getTime();
    return to.getTime() >= start.getTime() && to.getTime() <= end.getTime();
  }
  return false;
}

/** True when this lease should carry the city bill for `billingMonth` (YYYY-MM-DD). */
export function leaseCoversBillingMonth(
  lease: UtilityLeaseTerm,
  billingMonth: string,
  peers: readonly UtilityLeaseTerm[],
): boolean {
  const start = parseDay(billingMonth);
  const end = monthEnd(start);
  if (datedOverlap(lease, start, end)) return true;
  if (lease.status !== "Active") return false;
  if (lease.leaseFrom || lease.leaseTo) return false;
  const unit = lease.unitNumber ?? "";
  return !peers.some(
    (peer) =>
      peer.leaseId !== lease.leaseId &&
      (peer.unitNumber ?? "") === unit &&
      datedOverlap(peer, start, end),
  );
}

export function allocateLeasesForBillingMonth(
  propertyLeases: readonly UtilityLeaseTerm[],
  billingMonth: string | null,
  currentMonth: string,
  splitEvenly: boolean,
): { status: "resolved" | "ambiguous" | "no_active_lease"; leases: UtilityMonthLease[] } {
  const month = billingMonth ?? currentMonth;
  const covering = propertyLeases
    .filter((lease) => leaseCoversBillingMonth(lease, month, propertyLeases))
    .slice()
    .sort((left, right) => left.leaseId - right.leaseId);
  if (covering.length === 0) return { status: "no_active_lease", leases: [] };

  const byUnit = new Map<string, number>();
  for (const lease of covering) {
    const key = lease.unitNumber ?? "";
    byUnit.set(key, (byUnit.get(key) ?? 0) + 1);
  }
  if ([...byUnit.values()].some((count) => count > 1)) {
    return { status: "ambiguous", leases: [] };
  }
  if (covering.length > 1 && !splitEvenly) {
    return { status: "ambiguous", leases: [] };
  }
  const chargeShare = covering.length === 1 ? 1 : round4(1 / covering.length);
  return {
    status: "resolved",
    leases: covering.map((lease) => ({
      leaseId: lease.leaseId,
      unitNumber: lease.unitNumber,
      leaseTo: lease.leaseTo,
      rent: lease.rent,
      chargeShare,
    })),
  };
}
