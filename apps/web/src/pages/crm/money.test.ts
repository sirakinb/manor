import { describe, expect, it } from "vitest";
import { formatMoneyCents } from "./money";

describe("formatMoneyCents", () => {
  it("keeps city bill cents instead of rounding to whole dollars", () => {
    expect(formatMoneyCents(84.5)).toBe("$84.50");
    expect(formatMoneyCents(70.12)).toBe("$70.12");
    expect(formatMoneyCents(2433.11)).toBe("$2,433.11");
  });
});
