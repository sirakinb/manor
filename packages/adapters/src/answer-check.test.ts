import { describe, expect, it } from "vitest";
import { AnswerSources, extractClaims } from "./answer-check.js";

describe("extractClaims", () => {
  it("keeps factual sentences and skips code, questions, and fragments", () => {
    expect(
      extractClaims(
        [
          "## Summary",
          "All 42 tests passed on the main branch. The deploy finished at 3pm.",
          "- **Refund** of $50 was issued to the customer.",
          "```ts\nconst passed = true; // this is code, not a claim\n```",
          "Want me to open a pull request for this?",
          "Done!",
        ].join("\n"),
      ),
    ).toEqual([
      "All 42 tests passed on the main branch.",
      "The deploy finished at 3pm.",
      "Refund of $50 was issued to the customer.",
    ]);
  });

  it("drops duplicates and caps the list", () => {
    const reply = Array.from({ length: 30 }, (_, i) => `Item number ${i} was saved.`).join(" ");
    expect(extractClaims(`${reply} Item number 0 was saved.`)).toHaveLength(20);
    expect(extractClaims("The file was saved. The file was saved.")).toEqual([
      "The file was saved.",
    ]);
  });
});

describe("AnswerSources", () => {
  it("redacts secrets, strips binary payloads, and bounds size", () => {
    const sources = new AnswerSources();
    sources.add(
      "shell",
      { stdout: "token-secret ok", screenshot: `data:image/png;base64,${"A".repeat(200)}` },
      ["token-secret"],
    );
    sources.add("read_file", "x".repeat(10_000), []);
    sources.add("noop", undefined, []);
    expect(sources.items).toHaveLength(2);
    expect(sources.items[0]!.content).toBe('{"stdout":"[redacted] ok","screenshot":"[binary]"}');
    expect(sources.items[1]!.content).toHaveLength(4_000);
  });

  it("redacts sensitive keys in structured and JSON-text results", () => {
    const sources = new AnswerSources();
    sources.add("create_key", { key: { apiKey: "new-key", id: "k1" } }, []);
    sources.add("mcp_call", '{"access_token":"abc","user":"sam"}', []);
    expect(sources.items.map((item) => item.content)).toEqual([
      '{"key":{"apiKey":"[redacted]","id":"k1"}}',
      '{"access_token":"[redacted]","user":"sam"}',
    ]);
  });

  it("stops collecting after the source limit", () => {
    const sources = new AnswerSources();
    for (let i = 0; i < 40; i++) sources.add("web_fetch", `page ${i}`, []);
    expect(sources.items).toHaveLength(30);
  });
});
