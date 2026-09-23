import type { ActionReviewRequest, AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { ACTION_FIT_QUESTION, JevVerifier } from "./jev-verifier.js";

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
});
