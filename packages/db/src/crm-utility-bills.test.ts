import { describe, expect, it } from "vitest";
import {
  crmModuleLooksLikeUtilities,
  crmUtilitySyncNotice,
  extractCrmUtilityBill,
  indexCrmBillsByDueDate,
  matchCrmBillForNotice,
  parseCrmMoney,
  parseCrmServiceAddress,
  resolveCrmBillingMonth,
  resolveCrmDueDate,
} from "./crm-utility-bills.js";

const now = new Date(Date.UTC(2026, 8, 15));

const utilitiesFields = [
  { id: "addr", label: "Address" },
  { id: "charges", label: "Current charges" },
  { id: "month", label: "Billing month" },
  { id: "due", label: "Due date" },
  { id: "balance", label: "Account balance" },
];

describe("crmModuleLooksLikeUtilities", () => {
  it("matches utility sheets and ignores unrelated names", () => {
    expect(crmModuleLooksLikeUtilities("Utilities")).toBe(true);
    expect(crmModuleLooksLikeUtilities("Water bills")).toBe(true);
    expect(crmModuleLooksLikeUtilities("City bill")).toBe(true);
    expect(crmModuleLooksLikeUtilities("Sales")).toBe(false);
    expect(crmModuleLooksLikeUtilities("Properties")).toBe(false);
  });
});

describe("parseCrmMoney", () => {
  it("reads the city amount and ignores junk", () => {
    expect(parseCrmMoney(70.12)).toBe(70.12);
    expect(parseCrmMoney("$1,234.50")).toBe(1234.5);
    expect(parseCrmMoney("84.50")).toBe(84.5);
    expect(parseCrmMoney("")).toBeNull();
    expect(parseCrmMoney(-4)).toBeNull();
  });
});

describe("parseCrmServiceAddress", () => {
  it("requires a street number so property nicknames do not invent a match", () => {
    expect(parseCrmServiceAddress("12 Test St")).toBe("12 Test St");
    expect(parseCrmServiceAddress("Harbor House")).toBeNull();
  });
});

describe("resolveCrmBillingMonth", () => {
  it("defaults empty values to the current month and parses dated cells", () => {
    expect(resolveCrmBillingMonth(null, now)).toBe("2026-09-01");
    expect(resolveCrmBillingMonth("2026-07-18", now)).toBe("2026-07-01");
    expect(resolveCrmBillingMonth("July 2026", now)).toBe("2026-07-01");
    expect(resolveCrmBillingMonth("not a month", now)).toBeNull();
  });
});

describe("extractCrmUtilityBill", () => {
  it("takes Current charges from a Utilities sheet, never the account balance", () => {
    expect(
      extractCrmUtilityBill({
        moduleName: "Utilities",
        fields: utilitiesFields,
        values: {
          addr: "12 Test St",
          charges: 70.12,
          balance: 2433.11,
          month: "2026-07-01",
          due: "2026-07-21",
        },
        now,
      }),
    ).toEqual({
      ok: true,
      serviceAddress: "12 Test St",
      billingMonth: "2026-07-01",
      currentCharges: 70.12,
      dueDate: "2026-07-21",
    });
  });

  it("lets a utility-named sheet use Amount, but not Amount due", () => {
    expect(
      extractCrmUtilityBill({
        moduleName: "Water bills",
        fields: [
          { id: "addr", label: "Address" },
          { id: "amt", label: "Amount" },
          { id: "due", label: "Due date" },
        ],
        values: { addr: "12 Test St", amt: 84.5, due: "2026-09-29" },
        now,
      }),
    ).toMatchObject({
      ok: true,
      currentCharges: 84.5,
      billingMonth: "2026-09-01",
      dueDate: "2026-09-29",
    });
    expect(
      extractCrmUtilityBill({
        moduleName: "Water bills",
        fields: [
          { id: "addr", label: "Address" },
          { id: "due", label: "Amount due" },
        ],
        values: { addr: "12 Test St", due: 2433.11 },
        now,
      }),
    ).toEqual({ ok: false, reason: "no_amount_field" });
  });

  it("does not treat a Sales Amount column as a city bill", () => {
    expect(
      extractCrmUtilityBill({
        moduleName: "Sales",
        fields: [
          { id: "addr", label: "Address" },
          { id: "amt", label: "Amount" },
        ],
        values: { addr: "12 Test St", amt: 5000 },
        now,
      }),
    ).toEqual({ ok: false, reason: "not_utility_module" });
  });

  it("reads a Current charges sheet even when the module name is generic", () => {
    expect(
      extractCrmUtilityBill({
        moduleName: "September numbers",
        fields: [
          { id: "addr", label: "Property" },
          { id: "charges", label: "Current charges" },
          { id: "due", label: "Due date" },
        ],
        values: { addr: "12 Test St", charges: 70, due: "2026-09-29" },
        now,
      }),
    ).toMatchObject({
      ok: true,
      currentCharges: 70,
      serviceAddress: "12 Test St",
      dueDate: "2026-09-29",
    });
  });

  it("waits when the CRM row has no due date to line up with Gmail", () => {
    expect(
      extractCrmUtilityBill({
        moduleName: "Water bills",
        fields: [
          { id: "addr", label: "Address" },
          { id: "charges", label: "Current charges" },
        ],
        values: { addr: "12 Test St", charges: 70.12 },
        now,
      }),
    ).toEqual({ ok: false, reason: "missing_due_date" });
  });
});

describe("resolveCrmDueDate", () => {
  it("parses CRM date cells and WRD-style due dates", () => {
    expect(resolveCrmDueDate("2026-09-29")).toBe("2026-09-29");
    expect(resolveCrmDueDate("Sep. 29, 2026")).toBe("2026-09-29");
    expect(resolveCrmDueDate("September 29, 2026")).toBe("2026-09-29");
  });

  it("rejects calendar dates that do not exist", () => {
    expect(resolveCrmDueDate("2026-02-31")).toBeUndefined();
    expect(resolveCrmDueDate("Feb. 31, 2026")).toBeUndefined();
    expect(resolveCrmDueDate("February 31, 2026")).toBeUndefined();
  });
});

describe("indexCrmBillsByDueDate", () => {
  const july = {
    ok: true as const,
    serviceAddress: "12 Test St",
    billingMonth: "2026-07-01",
    currentCharges: 70.12,
    dueDate: "2026-07-21",
  };

  it("lines a Gmail notice up with the CRM row that shares its due date", () => {
    const index = indexCrmBillsByDueDate([july]);
    expect(matchCrmBillForNotice(index, "12 TEST STREET", "2026-07-21")).toMatchObject({
      currentCharges: 70.12,
    });
    expect(matchCrmBillForNotice(index, "12 Test St", "2026-08-21")).toBeNull();
  });

  it("does not pick an amount when two CRM rows disagree for the same due date", () => {
    const index = indexCrmBillsByDueDate([july, { ...july, currentCharges: 80 }]);
    expect(matchCrmBillForNotice(index, "12 Test St", "2026-07-21")).toBe("ambiguous");
  });
});

describe("crmUtilitySyncNotice", () => {
  it("explains an empty CRM sheet without inventing amounts", () => {
    expect(
      crmUtilitySyncNotice({ modules: 0, scanned: 0, applied: 0, skipped: 0, waiting: 0 }),
    ).toContain("Current charges");
    expect(
      crmUtilitySyncNotice({ modules: 1, scanned: 4, applied: 3, skipped: 0, waiting: 1 }),
    ).toContain("Matched 3");
    expect(
      crmUtilitySyncNotice({ modules: 1, scanned: 4, applied: 0, skipped: 2, waiting: 2 }),
    ).toContain("waiting on a matching CRM due date");
  });
});
