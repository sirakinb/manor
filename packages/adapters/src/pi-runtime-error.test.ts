import { TransientModelError } from "@rakazo/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ errorMessage: "" }));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state = { errorMessage: provider.errorMessage, messages: [] };

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

function consume() {
  const runtime = new PiAgentRuntime();
  return (async () => {
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
  })();
}

describe("Pi runtime errors", () => {
  beforeEach(() => {
    provider.errorMessage = "Request was aborted by policy";
  });

  it("propagates provider failures instead of completing with error text", async () => {
    const failure = consume();
    await expect(failure).rejects.toThrow("Request was aborted by policy");
    await expect(failure).rejects.not.toBeInstanceOf(TransientModelError);
  });

  it("attributes a permanent provider failure to the model stage", async () => {
    await expect(consume()).rejects.toMatchObject({
      message: "Request was aborted by policy",
      diagnostic: { stage: "model", category: "unknown", code: null },
    });
  });

  it("summarizes a categorized failure without leaking its details", async () => {
    provider.errorMessage = "fetch failed https://private.example.test?token=fake-secret";
    const failure = consume();
    await expect(failure).rejects.toBeInstanceOf(TransientModelError);
    await expect(failure).rejects.toThrow("Model request connection failed.");
    await expect(failure).rejects.toMatchObject({
      diagnostic: { stage: "model", category: "network", code: null },
    });
  });

  it("marks a provider overload that outlasted its retries as transient", async () => {
    provider.errorMessage =
      "Codex error: Our servers are currently overloaded. Please try again later.";
    const failure = consume();
    await expect(failure).rejects.toBeInstanceOf(TransientModelError);
    await expect(failure).rejects.toThrow("overloaded");
  });

  it("keeps a dropped connection transient", async () => {
    provider.errorMessage = "WebSocket closed 1006";
    await expect(consume()).rejects.toBeInstanceOf(TransientModelError);
  });
});
