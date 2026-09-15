import { describe, expect, it } from "vitest";
import {
  allocateLeasesForBillingMonth,
  leaseCoversBillingMonth,
  splitChargeAmounts,
  type UtilityLeaseTerm,
} from "./utility-leases.js";

const past: UtilityLeaseTerm = {
  leaseId: 40,
  unitNumber: "A",
  status: "Past",
  leaseFrom: "2026-01-01",
  leaseTo: "2026-07-31",
  rent: 1100,
};
const current: UtilityLeaseTerm = {
  leaseId: 41,
  unitNumber: "A",
  status: "Active",
  leaseFrom: "2026-08-01",
  leaseTo: "2027-06-30",
  rent: 1250,
};

describe("leaseCoversBillingMonth", () => {
  it("sends the month before turnover to the past lease id, not the new one", () => {
    const peers = [past, current];
    expect(leaseCoversBillingMonth(past, "2026-07-01", peers)).toBe(true);
    expect(leaseCoversBillingMonth(current, "2026-07-01", peers)).toBe(false);
    expect(leaseCoversBillingMonth(past, "2026-08-01", peers)).toBe(false);
    expect(leaseCoversBillingMonth(current, "2026-08-01", peers)).toBe(true);
  });

  it("lets an undated Active lease fill months no dated peer already covers", () => {
    const undated: UtilityLeaseTerm = { ...current, leaseFrom: null, leaseTo: null };
    const peers = [past, undated];
    expect(leaseCoversBillingMonth(undated, "2026-07-01", peers)).toBe(false);
    expect(leaseCoversBillingMonth(undated, "2026-08-01", peers)).toBe(true);
  });
});

describe("allocateLeasesForBillingMonth", () => {
  it("posts each month to the lease number that covered it", () => {
    const peers = [past, current];
    expect(allocateLeasesForBillingMonth(peers, "2026-07-01", "2026-09-01", false)).toEqual({
      status: "resolved",
      leases: [
        {
          leaseId: 40,
          unitNumber: "A",
          leaseTo: "2026-07-31",
          rent: 1100,
          chargeShare: 1,
        },
      ],
    });
    expect(allocateLeasesForBillingMonth(peers, "2026-08-01", "2026-09-01", false).leases).toEqual([
      expect.objectContaining({ leaseId: 41, chargeShare: 1 }),
    ]);
  });

  it("marks a mid-month turnover on the same unit as ambiguous", () => {
    const overlap: UtilityLeaseTerm = { ...current, leaseFrom: "2026-07-15" };
    expect(
      allocateLeasesForBillingMonth([past, overlap], "2026-07-01", "2026-09-01", false),
    ).toEqual({
      status: "ambiguous",
      leases: [],
    });
  });

  it("still splits a duplex across units for the same month", () => {
    const unitB: UtilityLeaseTerm = {
      leaseId: 2,
      unitNumber: "B",
      status: "Active",
      leaseFrom: "2026-01-01",
      leaseTo: "2027-01-01",
      rent: 1200,
    };
    const unitA: UtilityLeaseTerm = {
      leaseId: 1,
      unitNumber: "A",
      status: "Active",
      leaseFrom: "2026-01-01",
      leaseTo: "2027-01-01",
      rent: 1000,
    };
    const allocated = allocateLeasesForBillingMonth(
      [unitA, unitB],
      "2026-09-01",
      "2026-09-01",
      true,
    );
    expect(allocated.status).toBe("resolved");
    expect(allocated.leases.map((lease) => [lease.leaseId, lease.chargeShare])).toEqual([
      [1, 0.5],
      [2, 0.5],
    ]);
  });
});

describe("splitChargeAmounts", () => {
  it("keeps odd cents instead of rounding each share independently", () => {
    expect(splitChargeAmounts(70.13, [0.5, 0.5])).toEqual([35.06, 35.07]);
    expect(splitChargeAmounts(84.5, [0.5, 0.5])).toEqual([42.25, 42.25]);
    expect(splitChargeAmounts(70.12, [1])).toEqual([70.12]);
  });
});
