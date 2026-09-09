import { execFile } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AdapterContext, CommandRequest, ComputerRef } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  prepareRoutineWebhook,
  routineWebhookRedactionSecrets,
  routineWebhookToken,
} from "./routine-webhook.js";

const context = {
  spaceId: "space-1",
  userId: "user-1",
  operationId: "test",
  traceId: "test",
  signal: new AbortController().signal,
} satisfies AdapterContext;
const computer = {
  id: "computer-1",
  botId: "bot-1",
  kind: "docker",
  providerRef: "computer-1",
} satisfies ComputerRef;
const input = { botId: "bot-1", routineId: "routine-1" };
const routine = {
  id: "routine-1",
  name: "Welcome guide",
  prompt: "Send the exact welcome text and saved PDF to the submitter.",
  active: true,
};
const key = "synthetic-webhook-key-for-offline-tests";

function fixture(existing = true) {
  const tx = {
    secret: { create: vi.fn(), delete: vi.fn() },
    bot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const execute = vi.fn(async function* (_computer: ComputerRef, _request: CommandRequest) {
    yield { type: "stdout", data: "/tmp/manor-webhook.ABC12345/webhook.json" };
    yield { type: "exit", code: 0 };
  });
  const prisma = {
    routine: {
      findFirst: vi.fn().mockResolvedValue(routine),
      findMany: vi.fn().mockResolvedValue([{ id: routine.id }]),
    },
    bot: {
      findFirst: vi.fn().mockResolvedValue({
        id: "bot-1",
        userId: "user-1",
        webhookSecretId: existing ? "secret-1" : null,
      }),
      findUnique: vi.fn().mockResolvedValue({ webhookSecretId: "winner-secret" }),
    },
    secret: { findFirst: vi.fn().mockResolvedValue({ id: "secret-1", ciphertext: "encrypted" }) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const secretStore = {
    load: vi.fn().mockReturnValue(key),
    put: vi.fn().mockResolvedValue({ id: "new-secret", ciphertext: "encrypted" }),
  };
  const deps = {
    prisma,
    secretStore,
    sandbox: { execute },
    webhookBaseUrl: "https://manor.example.com",
  };
  const register = vi.fn();
  const prepare = (options = input, target = computer) =>
    prepareRoutineWebhook(
      deps as unknown as Parameters<typeof prepareRoutineWebhook>[0],
      options,
      target,
      context,
      register,
    );
  return { deps, tx, execute, prisma, secretStore, register, prepare };
}

describe("routine webhook setup handoff", () => {
  it("keeps chat available with an unreadable webhook key, while retaining unrelated errors", async () => {
    const f = fixture();
    const bot = { id: "bot-1", spaceId: "space-1", userId: "user-1", webhookSecretId: "secret-1" };
    const deps = f.deps as unknown as Parameters<typeof routineWebhookRedactionSecrets>[0];
    expect(await routineWebhookRedactionSecrets(deps, bot)).toEqual([
      key,
      routineWebhookToken(key, routine.id),
    ]);
    f.secretStore.load.mockImplementation(() => {
      throw new Error("Malformed ciphertext");
    });
    f.prisma.routine.findMany.mockClear();
    await expect(routineWebhookRedactionSecrets(deps, bot)).resolves.toEqual([]);
    expect(f.prisma.routine.findMany).not.toHaveBeenCalled();
    f.prisma.secret.findFirst.mockRejectedValue(new Error("Database unavailable"));
    await expect(routineWebhookRedactionSecrets(deps, bot)).rejects.toThrow("Database unavailable");
  });

  it.skipIf(process.platform === "win32")(
    "writes a private file without evaluating the instructions as shell code",
    async () => {
      const f = fixture();
      const prompt = 'Keep this literal: $(printf injected) " ; printf injected';
      f.prisma.routine.findFirst.mockResolvedValue({ ...routine, prompt });
      let setupFile = "";
      f.execute.mockImplementation(async function* (_computer, request) {
        const result = await promisify(execFile)(request.argv[0]!, request.argv.slice(1));
        setupFile = result.stdout.trim();
        yield { type: "stdout", data: result.stdout };
        yield { type: "exit", code: 0 };
      });
      try {
        expect(await f.prepare()).toMatchObject({ ok: true });
        expect(setupFile).toMatch(/^\/tmp\/manor-webhook\.[A-Za-z0-9]+\/webhook\.json$/);
        expect((await stat(setupFile)).mode & 0o777).toBe(0o600);
        expect((await stat(path.dirname(setupFile))).mode & 0o777).toBe(0o700);
        expect(JSON.parse(await readFile(setupFile, "utf8"))).toMatchObject({
          instructions: prompt,
        });
      } finally {
        if (/^\/tmp\/manor-webhook\.[A-Za-z0-9]+\/webhook\.json$/.test(setupFile)) {
          await rm(path.dirname(setupFile), { recursive: true, force: true });
        }
      }
    },
  );

  it("reuses the encrypted bot key and writes only a routine-scoped token outside the workspace", async () => {
    const f = fixture();
    const result = await f.prepare();
    expect(result).toMatchObject({
      ok: true,
      sourceConnected: false,
      setupFile: "/tmp/manor-webhook.ABC12345/webhook.json",
    });
    expect(f.secretStore.put).not.toHaveBeenCalled();
    expect(f.register).toHaveBeenCalledWith(routineWebhookToken(key, "routine-1"));
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain(routineWebhookToken(key, "routine-1"));
    const request = (
      f.execute.mock.calls as unknown as Array<[ComputerRef, { argv: string[] }]>
    )[0]![1];
    const setup = JSON.parse(request.argv[4]!);
    expect(request.argv[2]).toContain("umask 077");
    expect(request.argv[2]).not.toContain(routine.prompt);
    expect(setup).toMatchObject({
      url: "https://manor.example.com/api/v1/bots/bot-1/routines/routine-1/webhook",
      instructions: routine.prompt,
      headers: { Authorization: `Bearer ${routineWebhookToken(key, "routine-1")}` },
    });
    expect(f.prisma.routine.findFirst).toHaveBeenCalledWith({
      where: {
        id: "routine-1",
        botId: "bot-1",
        spaceId: "space-1",
        userId: "user-1",
        webhookEnabled: true,
      },
    });
  });

  it("installs the first key with compare-and-set", async () => {
    const f = fixture(false);
    expect(await f.prepare()).toMatchObject({ ok: true });
    expect(f.tx.bot.updateMany).toHaveBeenCalledWith({
      where: { id: "bot-1", webhookSecretId: null },
      data: { webhookSecretId: "new-secret" },
    });
  });

  it("uses a concurrent winner without rotating its key", async () => {
    const f = fixture(false);
    f.tx.bot.updateMany.mockResolvedValue({ count: 0 });
    expect(await f.prepare()).toMatchObject({ ok: true });
    expect(f.tx.secret.delete).toHaveBeenCalledWith({ where: { id: "new-secret" } });
    expect(f.prisma.secret.findFirst).toHaveBeenCalledWith({
      where: { id: "winner-secret", kind: "webhook", userId: "user-1", spaceId: "space-1" },
    });
  });

  it("rejects another owner's routine before accessing credentials", async () => {
    const f = fixture();
    f.prisma.routine.findFirst.mockResolvedValue(null);
    expect(await f.prepare()).toHaveProperty("error");
    expect(f.secretStore.load).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("does not export credentials to a group conversation", async () => {
    const f = fixture();
    expect(
      await prepareRoutineWebhook(
        f.deps as unknown as Parameters<typeof prepareRoutineWebhook>[0],
        { ...input, groupId: "group-1" },
        computer,
        context,
        f.register,
      ),
    ).toHaveProperty("error");
    expect(f.prisma.routine.findFirst).not.toHaveBeenCalled();
  });

  it("fails safely on a desktop computer or missing public origin", async () => {
    const f = fixture();
    expect(
      await prepareRoutineWebhook(
        f.deps as unknown as Parameters<typeof prepareRoutineWebhook>[0],
        input,
        { ...computer, kind: "desktop" },
        context,
        f.register,
      ),
    ).toHaveProperty("error");
    f.deps.webhookBaseUrl = "";
    expect(await f.prepare()).toHaveProperty("error");
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("does not echo command output when a setup write fails", async () => {
    const f = fixture();
    f.execute.mockImplementation(async function* () {
      yield { type: "stdout", data: key };
      yield { type: "exit", code: 1 };
    });
    const result = await f.prepare();
    expect(result).toHaveProperty("error");
    expect(JSON.stringify(result)).not.toContain(key);
  });
});
