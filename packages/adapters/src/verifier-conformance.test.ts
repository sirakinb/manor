import type {
  ActionReviewRequest,
  AdapterContext,
  AgentRuntime,
  AgentRuntimeEvent,
  Verifier,
} from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { createLlmVerifier } from "./auto-review.js";
import { FakeVerifier } from "./fake-verifier.js";
import { JevVerifier } from "./jev-verifier.js";

const ctx: AdapterContext = {
  operationId: "1",
  traceId: "1",
  spaceId: "s",
  userId: "u",
  signal: new AbortController().signal,
};

const request: ActionReviewRequest = {
  toolName: "gmail_send_email",
  connectorKind: "gmail",
  args: { to: "someone@example.test" },
  userTask: "Reply to the landlord",
  botDescription: "Mail bot",
  matchingRules: [],
};

function scriptedRuntime(events: AgentRuntimeEvent[] | Error): AgentRuntime {
  return {
    describe: () => ({
      id: "scripted",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { streaming: true, compaction: false, tools: false, scripted: true },
    }),
    async *run() {
      if (events instanceof Error) throw events;
      yield* events;
    },
    abort: async () => {},
  } as AgentRuntime;
}

function llmVerifier(runtime: AgentRuntime) {
  return createLlmVerifier({
    runtime,
    checker: { provider: "openrouter", model: "openai/gpt-5.6-luna" },
    runId: "r",
    botId: "b",
    threadId: "t",
    timeoutMs: 1_000,
  });
}

function jevVerifier(respond: () => Response | Promise<Response>) {
  return new JevVerifier({
    apiKey: "fake-typesafe-key",
    baseUrl: "https://jev.example.test",
    fetch: async () => respond(),
  });
}

const jevAnswer = (choice: string, confidence: number) =>
  Response.json({
    model: "jev-1.13.0",
    answers: {
      action_fit: {
        type: "choice",
        choice,
        confidence,
        probabilities: {
          fits: choice === "fits" ? 0.9 : 0.1,
          unexpected: choice === "fits" ? 0.1 : 0.9,
        },
      },
    },
    usage: { input_tokens: 300, output_tokens: 20 },
  });

/** Every engine answers with a known decision, measures itself, and never throws. */
async function assertVerifierConformance(verifier: Verifier, failing: Verifier) {
  expect(verifier.describe().contractVersion).toBe("1");
  expect(verifier.describe().capabilities.actions).toBe(true);

  const result = await verifier.reviewAction(request, ctx);
  expect(["pass", "ask"]).toContain(result.decision);
  expect(result.model).toBeTruthy();
  expect(result.latencyMs).toBeGreaterThanOrEqual(0);

  const failed = await failing.reviewAction(request, ctx);
  expect(failed.decision).toBe("error");
  expect(failed.reason).toBeTruthy();
}

describe("verifier conformance", () => {
  it("holds for the fake engine", async () => {
    const failing = new FakeVerifier();
    failing.result = { decision: "error", reason: "down", model: "fake", latencyMs: 0 };
    await assertVerifierConformance(new FakeVerifier(), failing);
  });

  it("holds for the LLM engine with a scripted runtime (offline)", async () => {
    await assertVerifierConformance(
      llmVerifier(
        scriptedRuntime([
          {
            type: "usage",
            inputTokens: 200,
            outputTokens: 10,
            provider: "openrouter",
            model: "m",
          },
          { type: "done", text: '{"decision":"ask","reason":"Outside the task."}' },
        ]),
      ),
      llmVerifier(scriptedRuntime(new Error("network down"))),
    );
  });

  it("holds for Jev with an injected backend (offline)", async () => {
    await assertVerifierConformance(
      jevVerifier(() => jevAnswer("fits", 0.9)),
      jevVerifier(() => new Response("overloaded", { status: 529 })),
    );
  });
});

describe("LLM engine measurement", () => {
  it("reports tokens and catalog cost", async () => {
    const result = await llmVerifier(
      scriptedRuntime([
        { type: "usage", inputTokens: 1_000, outputTokens: 100, provider: "p", model: "m" },
        { type: "done", text: '{"decision":"pass","reason":"Fits."}' },
      ]),
    ).reviewAction(request, ctx);
    expect(result).toMatchObject({ decision: "pass", inputTokens: 1_000, outputTokens: 100 });
    expect(result.costUsd).toBeGreaterThan(0);
  });
});
