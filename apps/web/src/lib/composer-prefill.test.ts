import { describe, expect, it } from "vitest";
import { composerPrefillFromState } from "./composer-prefill";

describe("workspace composer handoff", () => {
  const state = { composerPrefill: { botId: "bot-a", text: "Review voice calls" } };
  it("waits for the intended bot to be active", () => {
    expect(composerPrefillFromState(state, "entry", "bot-a", "bot-b")).toBeUndefined();
    expect(composerPrefillFromState(state, "entry", "bot-a", "bot-a")).toEqual({
      key: "entry",
      text: "Review voice calls",
    });
  });
  it("rejects malformed, oversized and cross-bot route state", () => {
    for (const invalid of [
      null,
      "prompt",
      { composerPrefill: { botId: "bot-b", text: "Other bot" } },
      { composerPrefill: { botId: "bot-a", text: "x".repeat(4001) } },
    ]) {
      expect(composerPrefillFromState(invalid, "entry", "bot-a", "bot-a")).toBeUndefined();
    }
    expect(composerPrefillFromState(state, "entry", undefined, "bot-a")).toBeUndefined();
  });
});
