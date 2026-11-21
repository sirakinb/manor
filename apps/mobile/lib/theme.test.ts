import { describe, expect, it } from "vitest";
import { botColors, tokens } from "./theme.js";

describe("mobile theme tokens", () => {
  it("exposes the shared product palette used by custom surfaces", () => {
    expect(tokens.page).toBe("#0A0A0A");
    expect(tokens.ink).toBe("#F1F0F3");
    expect(tokens.accent).toBe("#A855F7");
  });

  it("re-exports botColors for identity accents", () => {
    expect(botColors.length).toBeGreaterThan(0);
    // The first colour of Manor's sprite family.
    expect(botColors[0]).toBe("#8B5CF6");
  });
});
