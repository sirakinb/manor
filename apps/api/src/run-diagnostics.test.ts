import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";
import { getRunDiagnostics, listBotRunHistory } from "./runs.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@example.test",
  isDeploymentOwner: false,
};
const date = new Date("2026-01-01T00:00:00Z");
const run = {
  id: "run-1",
  botId: "bot-1",
  threadId: "thread-1",
  taskId: "task-1",
  status: "failed",
  trigger: "routine",
  routineId: "routine-1",
  modelProvider: "fake",
  modelId: "fake-model",
  error: "fetch failed https://private.example.test?token=fake-secret",
  startedAt: date,
  completedAt: date,
  createdAt: date,
};
function setup() {
  const event = (seq: number) => ({
    id: `event-${seq}`,
    seq,
    type: "agent.tool.called",
    createdAt: date,
    payload: {
      name: "shell",
      detail: "password=fake-secret",
      args: { command: "private command" },
    },
  });
  const db = {
    bot: { findFirst: vi.fn().mockResolvedValue({ id: "bot-1" }) },
    run: { findFirst: vi.fn().mockResolvedValue(run), findMany: vi.fn().mockResolvedValue([run]) },
    event: {
      findMany: vi.fn().mockResolvedValue(Array.from({ length: 101 }, (_, i) => event(101 - i))),
      findFirst: vi.fn().mockResolvedValue({
        payload: { diagnostic: { stage: "model", category: "network", code: "ECONNRESET" } },
      }),
    },
    attempt: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ status: "failed", startedAt: date, finishedAt: date }]),
    },
  };
  return { db, prisma: db as unknown as PrismaClient };
}
describe("run diagnostics boundary", () => {
  it("checks the actor's run ownership before reading any events or attempts", async () => {
    const { db, prisma } = setup();
    db.run.findFirst.mockResolvedValue(null);
    await expect(getRunDiagnostics(prisma, actor, { runId: "foreign-run" })).rejects.toThrow();
    expect(db.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "foreign-run",
          spaceId: "space-1",
          userId: "user-1",
          bot: { spaceId: "space-1", userId: "user-1" },
        }),
      }),
    );
    expect(db.event.findMany).not.toHaveBeenCalled();
    expect(db.attempt.findMany).not.toHaveBeenCalled();
  });
  it("returns bounded chronological metadata without raw event or error content", async () => {
    const { db, prisma } = setup();
    const result = await getRunDiagnostics(prisma, actor, { runId: "run-1", before: 200 });
    expect(result.events).toHaveLength(100);
    expect(result.events[0]?.seq).toBe(2);
    expect(result.olderCursor).toBe(2);
    expect(result.failure?.stage).toBe("model");
    expect(result.run.error).toBe("Model request connection failed (ECONNRESET).");
    expect(JSON.stringify(result)).not.toMatch(
      /fake-secret|private\.example|private command|password/,
    );
    expect(db.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          spaceId: "space-1",
          threadId: "thread-1",
          runId: "run-1",
          seq: { lt: 200 },
        }),
        take: 101,
      }),
    );
  });
  it("authorizes bot history and scopes it to the actor", async () => {
    const { db, prisma } = setup();
    await listBotRunHistory(prisma, actor, "bot-1");
    expect(db.run.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { botId: "bot-1", spaceId: "space-1", userId: "user-1" },
        take: 20,
      }),
    );
    db.bot.findFirst.mockResolvedValue(null);
    db.run.findMany.mockClear();
    await expect(listBotRunHistory(prisma, actor, "foreign-bot")).rejects.toThrow();
    expect(db.run.findMany).not.toHaveBeenCalled();
  });
  it("validates pagination and serializes the RPC contract", async () => {
    const { prisma } = setup();
    const handler = new RPCHandler(createRouter({ prisma } as RouterDeps));
    const call = (before: number) =>
      handler.handle(
        new Request("http://localhost/rpc/runs/diagnostics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { runId: "run-1", before } }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
    expect((await call(-1)).response?.status).toBe(400);
    const response = (await call(200)).response!;
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("fake-secret");
  });
});
