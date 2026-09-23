import type {
  ActionReviewRequest,
  AdapterContext,
  AgentRuntime,
  AgentRuntimeEvent,
  AnswerCheckRequest,
  ClaimVerdict,
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

const answerRequest: AnswerCheckRequest = {
  userTask: "Run the tests",
  claims: ["All 12 tests passed.", "The build was deployed to production."],
  sources: [{ tool: "shell", content: "12 passed, 0 failed" }],
};

/** Every engine answers with a known decision, measures itself, and never throws. */
async function assertVerifierConformance(engines: {
  actions: Verifier;
  answers: Verifier;
  failing: Verifier;
}) {
  for (const verifier of Object.values(engines)) {
    expect(verifier.describe().contractVersion).toBe("1");
    expect(verifier.describe().capabilities).toEqual({ actions: true, answers: true });
  }

  const result = await engines.actions.reviewAction(request, ctx);
  expect(["pass", "ask"]).toContain(result.decision);
  expect(result.model).toBeTruthy();
  expect(result.latencyMs).toBeGreaterThanOrEqual(0);

  const answer = await engines.answers.checkAnswer(answerRequest, ctx);
  expect(answer.decision).toBe("ask");
  expect((answer.details?.claims as ClaimVerdict[]).map((claim) => claim.supported)).toEqual([
    true,
    false,
  ]);
  expect(answer.latencyMs).toBeGreaterThanOrEqual(0);

  for (const failed of [
    await engines.failing.reviewAction(request, ctx),
    await engines.failing.checkAnswer(answerRequest, ctx),
  ]) {
    expect(failed.decision).toBe("error");
    expect(failed.reason).toBeTruthy();
  }
}

describe("verifier conformance", () => {
  it("holds for the fake engine", async () => {
    const answers = new FakeVerifier();
    answers.result = {
      decision: "ask",
      model: "fake",
      latencyMs: 0,
      details: {
        claims: answerRequest.claims.map((text, index) => ({ text, supported: index === 0 })),
      },
    };
    const failing = new FakeVerifier();
    failing.result = { decision: "error", reason: "down", model: "fake", latencyMs: 0 };
    await assertVerifierConformance({ actions: new FakeVerifier(), answers, failing });
  });

  it("holds for the LLM engine with a scripted runtime (offline)", async () => {
    const replying = (text: string) =>
      llmVerifier(
        scriptedRuntime([
          { type: "usage", inputTokens: 200, outputTokens: 10, provider: "openrouter", model: "m" },
          { type: "done", text },
        ]),
      );
    await assertVerifierConformance({
      actions: replying('{"decision":"ask","reason":"Outside the task."}'),
      answers: replying('{"unsupported":[2],"reason":"No deploy in the output."}'),
      failing: llmVerifier(scriptedRuntime(new Error("network down"))),
    });
  });

  it("holds for Jev with an injected backend (offline)", async () => {
    await assertVerifierConformance({
      actions: jevVerifier(() => jevAnswer("fits", 0.9)),
      answers: jevVerifier(() =>
        Response.json({
          model: "jev-1.13.0",
          answers: {
            claim_0: { type: "noul", noul: 0.94 },
            claim_1: { type: "noul", noul: 0.08 },
          },
          usage: { input_tokens: 500, output_tokens: 8 },
        }),
      ),
      failing: jevVerifier(() => new Response("overloaded", { status: 529 })),
    });
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
