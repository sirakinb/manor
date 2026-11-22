import { createRouterClient } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  organizationId: "org-1",
  email: "user@example.test",
  isDeploymentOwner: false,
};

type Row = Record<string, unknown>;

/** Upstream's account copy, Manor's space row and nothing else; every other read is empty. */
function harness(initial: { account?: Row; space?: Row } = {}) {
  const store = { account: initial.account ?? null, space: initial.space ?? null } as {
    account: Row | null;
    space: Row | null;
  };
  const upsert = (key: "account" | "space") =>
    vi.fn(async (args: { create: Row; update: Row }) => {
      const update = Object.fromEntries(
        Object.entries(args.update).filter(([, value]) => value !== undefined),
      );
      store[key] = store[key] ? { ...store[key], ...update } : { ...args.create };
      return store[key];
    });
  const pick = (row: Row | null, args?: { select?: Record<string, boolean> }) =>
    row && args?.select
      ? Object.fromEntries(Object.keys(args.select).map((field) => [field, row[field]]))
      : row;
  const known: Record<string, unknown> = {
    userActionAutoReviewPreference: {
      findUnique: vi.fn(async (args) => pick(store.account, args)),
      upsert: upsert("account"),
    },
    actionAutoReviewPreference: {
      findUnique: vi.fn(async (args) => pick(store.space, args)),
      upsert: upsert("space"),
    },
  };
  const empty = new Proxy(
    {},
    {
      get: (_target, method: string) =>
        vi.fn(async () => (method.startsWith("findMany") ? [] : method === "count" ? 0 : null)),
    },
  );
  const prisma: Record<string | symbol, unknown> = new Proxy(known, {
    get(target, model: string) {
      if (model in target) return target[model];
      if (model === "$transaction") return async (run: (tx: unknown) => unknown) => run(prisma);
      if (model === "$queryRaw") return vi.fn(async () => [{ locked: 1 }]);
      if (model === "$executeRaw") return vi.fn(async () => 0);
      if (model === "then") return undefined;
      return empty;
    },
  });
  const client = createRouterClient(
    createRouter({ prisma, secrets: { load: vi.fn() }, env: {} } as unknown as RouterDeps),
    { context: { actor } },
  );
  return { client, store };
}

describe("auto review settings", () => {
  it("reads the unsaved default, and a reply-check save leaves the mode unsaved", async () => {
    const { client, store } = harness();
    const before = await client.autoReview.get();
    expect(before).toMatchObject({ mode: "auto", checkAnswers: false });

    const after = await client.autoReview.set({ checkAnswers: true, compare: true });

    expect(store.account).toBeNull();
    expect(store.space).toMatchObject({ checkAnswers: true, compare: true });
    expect(after).toMatchObject({ mode: before.mode, checkAnswers: true, compare: true });
  });

  it("keeps an explicit Ask row and Manor's fields in their own places", async () => {
    const { client, store } = harness({
      account: { enabled: false, skipApprovals: false },
      space: { enabled: true, skipApprovals: false, checkAnswers: true, engine: "llm" },
    });
    expect(await client.autoReview.get()).toMatchObject({ mode: "ask", checkAnswers: true });

    await client.autoReview.set({ checkAnswers: false });
    expect(store.account).toEqual({ enabled: false, skipApprovals: false });
    expect(await client.autoReview.get()).toMatchObject({ mode: "ask", checkAnswers: false });

    await client.autoReview.set({ mode: "never" });
    expect(store.account).toMatchObject({ enabled: false, skipApprovals: true });
    expect(store.space).toMatchObject({ checkAnswers: false, engine: "llm" });
  });
});
