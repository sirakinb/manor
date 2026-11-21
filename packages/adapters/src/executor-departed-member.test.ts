import type * as Db from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutor } from "./executor.js";

const appendEventInTransaction = vi.hoisted(() => vi.fn(async () => ({ seq: 9 })));
const createPendingSteeringRun = vi.hoisted(() => vi.fn(async () => "run-2"));
const cancelDeactivatedAccountRuns = vi.hoisted(() => vi.fn(async () => 1));

vi.mock("@rakazo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  appendEventInTransaction,
  createPendingSteeringRun,
  cancelDeactivatedAccountRuns,
}));

// Manor: a team space's run acts as its shared account; the person who started it is
// initiatedByUserId, and it is their deactivation that stops the run.
describe("a team space's run started by a deactivated person", () => {
  function teamRun(initiatedByUserId: string) {
    const run = {
      id: "run-1",
      botId: "bot-1",
      threadId: "thread-1",
      taskId: "task-1",
      spaceId: "space-1",
      userId: "space-account",
      initiatedByUserId,
      status: "queued",
      trigger: "user",
      leaseFence: 0,
    };
    const prisma = {
      run: {
        findUnique: vi.fn(async () => run),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
          deactivatedAt: where.id === "ada" ? new Date("2026-11-01T00:00:00Z") : null,
        })),
      },
      // Past the deactivation check: the shared account is a member, then the claim stops.
      spaceMember: { findUnique: vi.fn(async () => ({ id: "member-account" })) },
      space: { findUnique: vi.fn(async () => ({ accountUserId: "space-account" })) },
      $transaction: vi.fn(async () => {
        throw new Error("fixture stops at the claim");
      }),
    };
    const events = { notify: vi.fn(async () => undefined) };
    const executor = createRunExecutor({
      prisma,
      runtime: { describe: () => ({ capabilities: { scripted: false } }), run: vi.fn() },
      events,
      jobs: { enqueue: vi.fn(async () => undefined) },
      secrets: [],
    } as unknown as Parameters<typeof createRunExecutor>[0]);
    return { executor, prisma, run };
  }

  it("does not start when the person who started it is deactivated", async () => {
    cancelDeactivatedAccountRuns.mockClear();
    const { executor, prisma, run } = teamRun("ada");
    await executor.continueRun(run.id, "worker-1");
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ada" } }),
    );
    expect(cancelDeactivatedAccountRuns).toHaveBeenCalledWith(
      prisma,
      expect.anything(),
      "ada",
      "run-1",
    );
    // Stopped before the membership check and the claim.
    expect(prisma.spaceMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("starts when another teammate started it", async () => {
    cancelDeactivatedAccountRuns.mockClear();
    const { executor, prisma, run } = teamRun("bea");
    await executor.continueRun(run.id, "worker-1").catch(() => undefined);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bea" } }),
    );
    expect(cancelDeactivatedAccountRuns).not.toHaveBeenCalled();
    expect(prisma.spaceMember.findUnique).toHaveBeenCalled();
  });
});

describe("a run whose sender has left the space", () => {
  it("is cancelled without starting, so it cannot use their accounts", async () => {
    const run = {
      id: "run-1",
      botId: "bot-1",
      threadId: "thread-1",
      taskId: "task-1",
      spaceId: "space-1",
      userId: "former-member",
      status: "queued",
      trigger: "user",
      leaseFence: 0,
    };
    const tx = {
      run: {
        findUnique: vi.fn(async () => run),
        findMany: vi.fn(async () => [run]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        updateManyAndReturn: vi.fn(async () => [{ id: run.id }]),
      },
      message: { findMany: vi.fn(async () => []) },
      secret: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      externalEffect: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      attempt: { updateMany: vi.fn(async () => ({ count: 0 })) },
      task: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const prisma = {
      run: {
        findUnique: vi.fn(async () => run),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      spaceMember: { findUnique: vi.fn(async () => null) },
      // A personal space: no shared team account.
      space: { findUnique: vi.fn(async () => ({ accountUserId: null })) },
      user: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const runtimeRun = vi.fn();
    const notify = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined);
    const executor = createRunExecutor({
      prisma,
      runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
      events: { notify },
      jobs: { enqueue },
      secrets: [],
    } as unknown as Parameters<typeof createRunExecutor>[0]);

    await executor.continueRun(run.id, "worker-1");

    expect(prisma.spaceMember.findUnique).toHaveBeenCalledWith({
      where: { spaceId_userId: { spaceId: "space-1", userId: "former-member" } },
      select: { id: true },
    });
    // Never claimed, never ran.
    expect(prisma.run.updateMany).not.toHaveBeenCalled();
    expect(runtimeRun).not.toHaveBeenCalled();
    expect(tx.run.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["run-1"] } }),
        data: expect.objectContaining({ status: "cancelled", leaseOwner: null }),
      }),
    );
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["task-1"] } },
      data: { status: "cancelled" },
    });
    expect(appendEventInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ runId: "run-1", type: "run.cancelled" }),
    );
    expect(notify).toHaveBeenCalledWith("thread-1", 9);
    // Another member's message waiting behind it starts their own run.
    expect(createPendingSteeringRun).toHaveBeenCalledWith(tx, expect.objectContaining(run));
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ payload: { runId: "run-2" } }));
  });

  // Manor: a team space's runs act as its shared account, which is never a departed member, even
  // if its `space_members` row were missing.
  it("never cancels a team space's run as its shared account", async () => {
    appendEventInTransaction.mockClear();
    createPendingSteeringRun.mockClear();
    const run = {
      id: "run-1",
      botId: "bot-1",
      threadId: "thread-1",
      taskId: "task-1",
      spaceId: "space-1",
      userId: "space-account",
      status: "queued",
      trigger: "user",
      leaseFence: 0,
    };
    const prisma = {
      run: {
        findUnique: vi.fn(async () => run),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      spaceMember: { findUnique: vi.fn(async () => null) },
      space: { findUnique: vi.fn(async () => ({ accountUserId: "space-account" })) },
      user: { findUnique: vi.fn(async () => null) },
      // Cancelling would mark the run cancelled through this; the claim stops on what is missing.
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const tx = {
      run: {
        findUnique: vi.fn(async () => run),
        findMany: vi.fn(async () => [run]),
        updateManyAndReturn: vi.fn(async () => [{ id: run.id }]),
      },
    };
    const executor = createRunExecutor({
      prisma,
      runtime: { describe: () => ({ capabilities: { scripted: false } }), run: vi.fn() },
      events: { notify: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined) },
      secrets: [],
    } as unknown as Parameters<typeof createRunExecutor>[0]);

    // Past the membership check the run is claimed; this fixture stops it there.
    await executor.continueRun(run.id, "worker-1").catch(() => undefined);

    expect(prisma.space.findUnique).toHaveBeenCalledWith({
      where: { id: "space-1" },
      select: { accountUserId: true },
    });
    expect(tx.run.updateManyAndReturn).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }),
    );
    expect(appendEventInTransaction).not.toHaveBeenCalled();
    expect(createPendingSteeringRun).not.toHaveBeenCalled();
  });
});
