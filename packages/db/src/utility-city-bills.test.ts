import { describe, expect, it } from "vitest";
import { matchBillsToProperties, normStreetAddr, sameStreetAddr } from "./utility-city-bills.js";

const property = (id: string, ...addresses: string[]) => ({
  id,
  utility: "water",
  addressNorms: addresses.map(normStreetAddr),
});

const bill = (
  address: string | null,
  extra: { dueDate?: string; balance?: number; amountDue?: number } = {},
) => ({
  utility: "water",
  serviceAddressNorm: address === null ? null : normStreetAddr(address),
  dueDate: extra.dueDate ? new Date(`${extra.dueDate}T00:00:00.000Z`) : null,
  accountBalance: extra.balance ?? null,
  amountDue: extra.amountDue ?? null,
});

describe("sameStreetAddr", () => {
  it("ignores street type and a missing direction", () => {
    expect(sameStreetAddr(normStreetAddr("12 Main St"), normStreetAddr("12 N MAIN STREET"))).toBe(
      true,
    );
    expect(sameStreetAddr(normStreetAddr("7 Oak Rd"), normStreetAddr("7 Oak"))).toBe(true);
  });

  it("never treats opposite directions or different numbers as the same place", () => {
    expect(sameStreetAddr(normStreetAddr("40 N 9th St"), normStreetAddr("40 S 9th St"))).toBe(
      false,
    );
    expect(sameStreetAddr(normStreetAddr("12 Main St"), normStreetAddr("14 Main St"))).toBe(false);
    expect(sameStreetAddr(normStreetAddr("12 Main St"), normStreetAddr("12 Main Place"))).toBe(
      false,
    );
  });
});

describe("matchBillsToProperties", () => {
  it("prefers an exact address or saved spelling", () => {
    const main = property("main", "12 Main St", "12 Main Street Rear");
    const exact = bill("12 MAIN ST");
    const spelled = bill("12 Main Street Rear");
    const matches = matchBillsToProperties([exact, spelled], [main]);
    expect(matches.get(exact)).toEqual({ property: main, matchedBy: "address" });
    expect(matches.get(spelled)).toEqual({ property: main, matchedBy: "address" });
  });

  it("matches a variation only when one property fits", () => {
    const main = property("main", "12 Main St");
    const variant = bill("12 N MAIN ST");
    expect(matchBillsToProperties([variant], [main]).get(variant)).toEqual({
      property: main,
      matchedBy: "variation",
    });
    const north = property("north", "40 N 9th St");
    const south = property("south", "40 S 9th St");
    const undirected = bill("40 9th St");
    expect(matchBillsToProperties([undirected], [north, south]).has(undirected)).toBe(false);
  });

  it("falls back to the same total amount due and due date as a matched bill", () => {
    const main = property("main", "12 Main St");
    const notice = bill("12 Main St", { dueDate: "2026-10-20", balance: 333.83 });
    const crm = bill("12 MAIN STREET UNIT 1 BLDG B", { dueDate: "2026-10-20", amountDue: 333.83 });
    const otherDate = bill("Somewhere Else", { dueDate: "2026-10-21", amountDue: 333.83 });
    const untracked = bill("99 Elsewhere Rd", { dueDate: "2026-10-20", balance: 50 });
    const coincidence = bill("50 Other St", { dueDate: "2026-10-20", amountDue: 333.83 });
    const matches = matchBillsToProperties(
      [notice, crm, otherDate, untracked, coincidence],
      [main],
    );
    expect(matches.get(crm)).toEqual({ property: main, matchedBy: "balance_due_date" });
    expect(matches.has(otherDate)).toBe(false);
    expect(matches.has(untracked)).toBe(false);
    // Another address with the same balance and due date is a coincidence, not a match.
    expect(matches.has(coincidence)).toBe(false);
  });

  it("leaves a balance and due date shared by two properties unmatched", () => {
    const a = property("a", "1 First St");
    const b = property("b", "2 Second St");
    const unknown = bill("1 Second St", { dueDate: "2026-10-20", balance: 10 });
    const matches = matchBillsToProperties(
      [
        bill("1 First St", { dueDate: "2026-10-20", balance: 10 }),
        bill("2 Second St", { dueDate: "2026-10-20", balance: 10 }),
        unknown,
      ],
      [a, b],
    );
    expect(matches.has(unknown)).toBe(false);
  });
});
