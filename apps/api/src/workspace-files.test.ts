import { RPCHandler } from "@orpc/server/fetch";
import { FakeSandboxProvider } from "@rakazo/adapters";
import type { Actor, WorkspaceFileOperation } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@rakazo.test",
  isDeploymentOwner: true,
};
async function setup({ running = false, foreign = false, mode = "team", asleep = false } = {}) {
  const sandbox = new FakeSandboxProvider();
  const ref = await sandbox.provision(
    { botId: "home-1", homePath: "unused" },
    {
      spaceId: actor.spaceId,
      userId: actor.userId,
      botId: "bot-1",
      operationId: "test",
      traceId: "test",
      signal: new AbortController().signal,
    },
  );
  const computer = {
    id: "computer-1",
    homeKey: "home-1",
    kind: "fake",
    providerRef: ref.id,
    state: asleep ? "stopped" : "running",
    scope: mode,
  };
  const prisma = {
    bot: { findFirst: vi.fn().mockResolvedValue(foreign ? null : { id: "bot-1", computer }) },
    computer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    computerExecutionLease: { findFirst: vi.fn().mockResolvedValue(null) },
    run: { findFirst: vi.fn().mockResolvedValue(running ? { id: "other-bot-run" } : null) },
  };
  const execute = vi.spyOn(sandbox, "execute");
  const deps = {
    prisma,
    sandbox,
    jobs: { enqueue: vi.fn().mockResolvedValue(undefined) },
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/rakazo-files-test",
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  const call = async (operation: WorkspaceFileOperation, location = "bot") => {
    const { response } = await handler.handle(
      new Request("http://127.0.0.1/rpc/computer/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { botId: "bot-1", location, operation } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    return response;
  };
  return { call, prisma, execute, sandbox };
}

describe("workspace file API", () => {
  it("authorizes access before reaching the computer", async () => {
    const { call, execute, prisma } = await setup({ foreign: true });
    const response = await call({ action: "create", path: "notes.txt", kind: "file" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(execute).not.toHaveBeenCalled();
    expect(prisma.bot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "bot-1", spaceId: "space-1", userId: "user-1" }),
      }),
    );
  });
  it("rejects mutations while any bot works on the Team Computer and releases the lock", async () => {
    const { call, execute, prisma } = await setup({ running: true });
    expect((await call({ action: "create", path: "notes.txt", kind: "file" })).status).toBe(409);
    expect(execute).not.toHaveBeenCalled();
    expect(prisma.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bot: { computerId: "computer-1" } }),
      }),
    );
    expect(prisma.computer.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { executionRunId: null, executionLeaseExpiresAt: null } }),
    );
  });
  it("maps locations explicitly and allows only Team Computers to use shared files", async () => {
    const { call, sandbox } = await setup();
    expect(
      (await call({ action: "create", path: "shared.txt", kind: "file" }, "shared")).status,
    ).toBe(200);
    expect([...sandbox.boxes.values()][0]!.files.has("shared/shared.txt")).toBe(true);
    expect((await call({ action: "create", path: "private.txt", kind: "file" })).status).toBe(200);
    expect([...sandbox.boxes.values()][0]!.files.has("bots/bot-1/private.txt")).toBe(true);
    const privateComputer = await setup({ mode: "dedicated" });
    expect(
      (
        await privateComputer.call(
          { action: "list", path: "", search: "", hidden: false },
          "shared",
        )
      ).status,
    ).toBe(400);
  });
  it("requires a running computer and rejects invalid paths before execution", async () => {
    const asleep = await setup({ asleep: true });
    expect((await asleep.call({ action: "create", path: "notes.txt", kind: "file" })).status).toBe(
      400,
    );
    expect(asleep.execute).not.toHaveBeenCalled();
    const current = await setup();
    expect(
      (await current.call({ action: "create", path: "../outside.txt", kind: "file" })).status,
    ).toBe(400);
    expect(current.execute).not.toHaveBeenCalled();
  });
});
