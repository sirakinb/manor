import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { projectMessages, reduceLiveMessageBlocks } from "./events.js";

describe("reduceLiveMessageBlocks · thinking", () => {
  it("opens a thought before any text and grows it with deltas", () => {
    let blocks = reduceLiveMessageBlocks([], { type: "thinking", payload: { text: "Let me " } });
    blocks = reduceLiveMessageBlocks(blocks, { type: "thinking", payload: { delta: "check." } });
    expect(blocks).toEqual([{ kind: "thinking", text: "Let me check." }]);
  });

  it("closes the thought with a duration and lets the reply stream after it", () => {
    let blocks: MessageBlock[] = [{ kind: "thinking", text: "Hmm" }];
    blocks = reduceLiveMessageBlocks(blocks, {
      type: "thinking",
      payload: { done: true, durationMs: 2400 },
    });
    expect(blocks).toEqual([{ kind: "thinking", text: "Hmm", durationMs: 2400 }]);
    blocks = reduceLiveMessageBlocks(blocks, { type: "progress", payload: { text: "Sure, " } });
    blocks = reduceLiveMessageBlocks(blocks, { type: "progress", payload: { delta: "here." } });
    expect(blocks).toEqual([
      { kind: "thinking", text: "Hmm", durationMs: 2400 },
      { kind: "progress", text: "Sure, here." },
    ]);
  });

  it("freezes live reply text before a mid-turn thought and starts a new one", () => {
    let blocks: MessageBlock[] = [
      { kind: "thinking", text: "first", durationMs: 100 },
      { kind: "progress", text: "Working on it." },
    ];
    blocks = reduceLiveMessageBlocks(blocks, { type: "thinking", payload: { delta: "second" } });
    expect(blocks).toEqual([
      { kind: "thinking", text: "first", durationMs: 100 },
      { kind: "text", text: "Working on it." },
      { kind: "thinking", text: "second" },
    ]);
  });

  it("keeps pending tool names on the mutable tail across a thought", () => {
    let blocks: MessageBlock[] = [
      { kind: "progress", text: "Let me look", pendingToolNames: ["web_search"] },
    ];
    blocks = reduceLiveMessageBlocks(blocks, {
      type: "thinking",
      payload: { delta: "Search first." },
    });
    expect(blocks).toEqual([
      { kind: "text", text: "Let me look" },
      { kind: "thinking", text: "Search first." },
      { kind: "progress", text: "", pendingToolNames: ["web_search"] },
    ]);
    // A later text delta resolves the pending tool at the sentence boundary.
    blocks = reduceLiveMessageBlocks(blocks, { type: "progress", payload: { delta: " Done." } });
    expect(blocks.at(-1)).toEqual({ kind: "steps", steps: [{ label: "Web search", count: 1 }] });
  });

  it("projects thread.thinking events into the live message on reload", () => {
    const base = { threadId: "t1", botId: "b1", runId: "r1", createdAt: "2026-09-02T00:00:00Z" };
    const messages = projectMessages([
      { ...base, id: "e1", seq: 1, type: "thread.thinking", payload: { text: "Plan: " } },
      { ...base, id: "e2", seq: 2, type: "thread.thinking", payload: { delta: "open portal." } },
      {
        ...base,
        id: "e3",
        seq: 3,
        type: "thread.thinking",
        payload: { done: true, durationMs: 1500 },
      },
      { ...base, id: "e4", seq: 4, type: "thread.progress", payload: { text: "Opening…" } },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("progress:r1");
    expect(messages[0]?.blocks).toEqual([
      { kind: "thinking", text: "Plan: open portal.", durationMs: 1500 },
      { kind: "progress", text: "Opening…" },
    ]);
  });
});
