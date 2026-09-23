import type { ActionReviewRequest, AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { ACTION_FIT_QUESTION, CLAIM_SUPPORT_QUESTION, JevVerifier } from "./jev-verifier.js";

const ctx: AdapterContext = {
  operationId: "1",
  traceId: "1",
  spaceId: "s",
  userId: "u",
  signal: new AbortController().signal,
};

const request: ActionReviewRequest = {
  toolName: "stripe_refund",
  connectorKind: "stripe",
  args: { amount: 5000 },
  userTask: "Summarize last week's payouts",
  botDescription: "Finance bot",
  matchingRules: ["always_allow:category:email"],
};

function answer(choice: "fits" | "unexpected", unexpected: number, confidence: number) {
  return {
    model: "jev-1.13.0",
    answers: {
      action_fit: {
        type: "choice",
        choice,
        probabilities: { fits: 1 - unexpected, unexpected },
        confidence,
      },
    },
    usage: { input_tokens: 1_000_000, output_tokens: 12 },
  };
}

function verifierReturning(body: unknown, calls: Array<[string, RequestInit]> = []) {
  return new JevVerifier({
    apiKey: "fake-typesafe-key",
    baseUrl: "https://jev.example.test/",
    minConfidence: 0.6,
    fetch: async (url, init) => {
      calls.push([String(url), init!]);
      return Response.json(body);
    },
  });
}

describe("JevVerifier", () => {
  it("sends the action as state with one choice question", async () => {
    const calls: Array<[string, RequestInit]> = [];
    await verifierReturning(answer("fits", 0.1, 0.9), calls).reviewAction(request, ctx);
    const [url, init] = calls[0]!;
    expect(url).toBe("https://jev.example.test/v1/systemone");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fake-typesafe-key");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "jev-latest",
      state: {
        tool: "stripe_refund",
        connector: "stripe",
        tool_args: { amount: 5000 },
        user_task: "Summarize last week's payouts",
        bot: "Finance bot",
        matching_rules: ["always_allow:category:email"],
      },
      questions: { action_fit: ACTION_FIT_QUESTION },
    });
  });

  it.each([
    ["a confident fit passes", answer("fits", 0.1, 0.9), "pass"],
    ["an unexpected action asks", answer("unexpected", 0.8, 0.7), "ask"],
    ["a low-confidence fit asks", answer("fits", 0.45, 0.3), "ask"],
  ] as const)("%s", async (_name, body, decision) => {
    const result = await verifierReturning(body).reviewAction(request, ctx);
    expect(result.decision).toBe(decision);
    expect(result.probability).toBe(body.answers.action_fit.probabilities.unexpected);
    expect(result.confidence).toBe(body.answers.action_fit.confidence);
    expect(result.details).toMatchObject({
      choice: body.answers.action_fit.choice,
      probabilities: body.answers.action_fit.probabilities,
    });
  });

  it("reports the answering model version and input-token cost", async () => {
    const result = await verifierReturning(answer("fits", 0.1, 0.9)).reviewAction(request, ctx);
    expect(result).toMatchObject({ model: "jev-1.13.0", inputTokens: 1_000_000, outputTokens: 12 });
    expect(result.costUsd).toBeCloseTo(0.042);
  });

  it("returns an error decision for malformed answers and failed requests", async () => {
    expect((await verifierReturning({ answers: {} }).reviewAction(request, ctx)).decision).toBe(
      "error",
    );
    const throwing = new JevVerifier({
      apiKey: "k",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await throwing.reviewAction(request, ctx)).toMatchObject({
      decision: "error",
      reason: "Checker timed out or failed.",
    });
  });

  it.each([
    ["an unknown choice", { ...answer("fits", 0.1, 0.9).answers.action_fit, choice: "uncertain" }],
    [
      "an out-of-range confidence",
      { ...answer("fits", 0.1, 0.9).answers.action_fit, confidence: 7 },
    ],
    [
      "a missing probability",
      { ...answer("fits", 0.1, 0.9).answers.action_fit, probabilities: { fits: 0.9 } },
    ],
  ])("fails closed on %s", async (_name, actionFit) => {
    const result = await verifierReturning({ answers: { action_fit: actionFit } }).reviewAction(
      request,
      ctx,
    );
    expect(result.decision).toBe("error");
  });

  it("gives up at its timeout", async () => {
    const hanging = new JevVerifier({
      apiKey: "k",
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)),
        ),
    });
    expect((await hanging.reviewAction(request, ctx)).decision).toBe("error");
  });

  it("asks one yes/no question per claim against the redacted sources", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const result = await verifierReturning(
      {
        model: "jev-1.13.0",
        answers: {
          claim_0: { type: "noul", noul: 0.9 },
          claim_1: { type: "noul", noul: 0.3 },
        },
        usage: { input_tokens: 800, output_tokens: 10 },
      },
      calls,
    ).checkAnswer(
      {
        userTask: "Run the tests",
        claims: ["All tests passed.", "Coverage went up to 90%."],
        sources: [{ tool: "shell", content: "12 passed" }],
      },
      ctx,
    );
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({
      model: "jev-latest",
      state: { user_task: "Run the tests", sources: [{ tool: "shell", content: "12 passed" }] },
      questions: {
        claim_0: {
          type: "noul",
          instructions: { claim: "All tests passed.", question: CLAIM_SUPPORT_QUESTION },
        },
        claim_1: {
          type: "noul",
          instructions: { claim: "Coverage went up to 90%.", question: CLAIM_SUPPORT_QUESTION },
        },
      },
    });
    expect(result).toMatchObject({
      decision: "ask",
      probability: 0.7,
      details: {
        claims: [
          { text: "All tests passed.", supported: true, probability: 0.9 },
          { text: "Coverage went up to 90%.", supported: false, probability: 0.3 },
        ],
      },
    });
  });

  it("fails closed when any claim is missing an answer", async () => {
    const result = await verifierReturning({
      answers: { claim_0: { type: "noul", noul: 0.9 } },
    }).checkAnswer(
      { userTask: "t", claims: ["First claim is here.", "Second claim is here."], sources: [] },
      ctx,
    );
    expect(result.decision).toBe("error");
  });
});
