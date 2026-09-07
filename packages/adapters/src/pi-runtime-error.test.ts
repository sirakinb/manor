import { describe, expect, it, vi } from "vitest";

const modelFailure = vi.hoisted(() => ({ message: "" }));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state = { errorMessage: modelFailure.message, messages: [] };

    subscribe() {}
    async prompt() {}
    async waitForIdle() {}
    abort() {}
  },
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    getModel: () => ({ provider: "openai-codex", id: "gpt-test" }),
    streamSimple: vi.fn(),
  }),
}));

vi.mock("./pi-local-provider.js", () => ({
  registerLocalProvider: (models: unknown) => models,
}));

vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import { PiAgentRuntime } from "./pi-runtime.js";

describe("Pi runtime errors", () => {
  it.each([
    ["WebSocket closed 1006", "WebSocket closed 1006", "unknown"],
    [
      "fetch failed https://private.example.test?token=fake-secret",
      "Model request connection failed.",
      "network",
    ],
  ])("propagates and attributes provider failures: %s", async (message, expected, category) => {
    modelFailure.message = message;
    const runtime = new PiAgentRuntime();
    const consume = async () => {
      for await (const _event of runtime.run(
        {
          botId: "bot",
          threadId: "thread",
          runId: "run",
          prompt: "continue",
          instructions: "test",
          history: [],
          tools: [],
          model: { provider: "openai-codex", id: "gpt-test" },
        },
        {
          operationId: "operation",
          traceId: "trace",
          spaceId: "workspace",
          userId: "user",
          signal: new AbortController().signal,
        },
      )) {
        // Consume the stream so terminal failures surface to the executor.
      }
    };

    await expect(consume()).rejects.toMatchObject({
      message: expected,
      diagnostic: { stage: "model", category, code: null },
    });
  });
});
