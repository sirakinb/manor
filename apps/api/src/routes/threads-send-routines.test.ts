import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { sendThreadMessage } from "../threads/thread-target.js";
import type { RouterContext } from "./context.js";
import { threadsRoutes } from "./threads.js";

vi.mock("../threads/thread-target.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../threads/thread-target.js")>()),
  resolveThreadTarget: vi.fn(async () => ({ kind: "bot", botId: "bot-1", threadId: "thread-1" })),
  sendThreadMessage: vi.fn(async () => ({ taskId: "task-1", runId: "run-1", seq: 1 })),
}));
vi.mock("./shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared.js")>()),
  modelSetup: vi.fn(async () => ({ needsModel: false, hasDeployment: false })),
}));
vi.mock("../bots/taught-skills.js", () => ({ assertTeachingSendAllowed: vi.fn(async () => {}) }));
vi.mock("../routines/routines.js", () => ({
  routineTestTarget: vi.fn(async () => ({ routine: { id: "routine-1", prompt: "Check in" } })),
  routineTestRunNonce: (_actor: Actor, nonce: string) => nonce,
  createRoutineTestRun: vi.fn(async () => ({ id: "routine-run-1" })),
}));

/** Every procedure builder returns its handler, so the test calls handlers directly. */
const builders: unknown = new Proxy(() => {}, {
  get: (_target, key) => (key === "handler" ? (fn: unknown) => fn : builders),
});

const actor = {
  userId: "user-1",
  spaceId: "space-1",
  organizationId: "org-1",
  email: "user@rakazo.test",
  isDeploymentOwner: false,
} as Actor;

describe("threads.sendWithRoutines", () => {
  it("forwards the tool routing mode to the message send, as threads.send does", async () => {
    const ctx = {
      deps: {
        prisma: { run: { findMany: vi.fn(async () => []) } },
        env: { defaultProvider: "fake", defaultModel: "fake-model" },
      },
      spaceAuthed: builders,
      callsEnabled: builders,
      agentSkills: { listWithContent: vi.fn(async () => []) },
    } as unknown as RouterContext;
    const routes = threadsRoutes(ctx) as unknown as {
      threads: Record<string, (args: { context: unknown; input: unknown }) => Promise<unknown>>;
    };
    const input = {
      botId: "bot-1",
      text: "Run it",
      clientNonce: "nonce-1",
      routineIds: ["routine-1"],
      toolRoutingMode: "plugins",
    };
    for (const name of ["send", "sendWithRoutines"]) {
      vi.mocked(sendThreadMessage).mockClear();
      await routes.threads[name]!({ context: { actor }, input });
      expect(vi.mocked(sendThreadMessage).mock.calls[0]?.[3]).toMatchObject({
        toolRoutingMode: "plugins",
      });
    }
  });
});
