import type { JobPublisher } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { wakeNextMentioned } from "./room-handoff.js";

const scout = { id: "b-scout", name: "Scout" };
const quill = { id: "b-quill", name: "Quill" };
const turnAt = new Date("2026-08-22T12:00:00Z");

/**
 * The queue of who still owes a turn is read back from the transcript, so a
 * fake only has to answer: what did the person say, and who has run since.
 */
function room(options: { kind?: string; text?: string; activeRuns?: number; ranSince?: string[] }) {
  const created: Array<{ botId: string }> = [];
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    thread: {
      findUnique: vi.fn().mockResolvedValue({ id: "t-1", kind: options.kind ?? "room" }),
    },
    run: {
      count: vi.fn().mockResolvedValue(options.activeRuns ?? 0),
      findMany: vi.fn().mockResolvedValue((options.ranSince ?? []).map((botId) => ({ botId }))),
      create: vi.fn(async ({ data }: { data: { botId: string } }) => {
        created.push({ botId: data.botId });
        return { id: `run-${created.length}` };
      }),
    },
    message: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.text === undefined
            ? null
            : { createdAt: turnAt, blocks: [{ kind: "text", text: options.text }] },
        ),
    },
    bot: { findMany: vi.fn().mockResolvedValue([scout, quill]) },
    task: { create: vi.fn().mockResolvedValue({ id: "task-1" }) },
  } as unknown as PrismaClient;

  return { prisma, jobs: { enqueue } as unknown as JobPublisher, created, enqueue };
}

const input = { threadId: "t-1", workspaceId: "w-1", userId: "u-1" };

describe("wakeNextMentioned", () => {
  it("wakes the first named bot that has not run yet", async () => {
    const deps = room({ text: "@Scout find them, then @Quill write it up", ranSince: ["b-scout"] });
    await expect(wakeNextMentioned(deps, input)).resolves.toBe("b-quill");
    expect(deps.created).toEqual([{ botId: "b-quill" }]);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
  });

  it("waits while anyone is still working", async () => {
    // Whoever is running will call this again when they finish.
    const deps = room({ text: "@Scout then @Quill", activeRuns: 1 });
    await expect(wakeNextMentioned(deps, input)).resolves.toBeNull();
    expect(deps.created).toEqual([]);
  });

  it("stops once everyone named has had a turn", async () => {
    const deps = room({
      text: "@Scout then @Quill",
      ranSince: ["b-scout", "b-quill"],
    });
    await expect(wakeNextMentioned(deps, input)).resolves.toBeNull();
    expect(deps.created).toEqual([]);
  });

  it("counts a failed run as a turn, so a broken bot is not woken forever", async () => {
    // `ranSince` is every run since the human turn, whatever its status.
    const deps = room({ text: "@Quill go", ranSince: ["b-quill"] });
    await expect(wakeNextMentioned(deps, input)).resolves.toBeNull();
  });

  it("keeps the order the person wrote them in", async () => {
    const deps = room({ text: "@Quill drafts after @Scout researches" });
    await expect(wakeNextMentioned(deps, input)).resolves.toBe("b-quill");
  });

  it("ignores a turn that names nobody", async () => {
    const deps = room({ text: "thanks, that works" });
    await expect(wakeNextMentioned(deps, input)).resolves.toBeNull();
  });

  it("leaves direct threads alone", async () => {
    const deps = room({ kind: "direct", text: "@Scout go" });
    await expect(wakeNextMentioned(deps, input)).resolves.toBeNull();
    expect(deps.created).toEqual([]);
  });

  it("does nothing when the room has no human turn yet", async () => {
    const deps = room({});
    await expect(wakeNextMentioned(deps, input)).resolves.toBeNull();
  });
});
