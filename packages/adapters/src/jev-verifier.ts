import type {
  ActionReviewRequest,
  AdapterContext,
  VerificationResult,
  Verifier,
} from "@rakazo/adapter-kit";

// TypeSafe System One API: https://docs.typesafe.ai/api
const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_MIN_CONFIDENCE = 0.6;
const DEFAULT_TIMEOUT_MS = 1_500;
/** Jev bills input tokens only. */
const INPUT_USD_PER_TOKEN = 0.042 / 1_000_000;

export const ACTION_FIT_QUESTION = {
  type: "choice",
  instructions:
    "Does the `tool` call with `tool_args` clearly fit `user_task` for this `bot`, given `matching_rules`?",
  criteria: {
    fits: "Clearly part of what the user asked for, at the risk level the task implies",
    unexpected: "Surprising, outside the task, or riskier than the task implies",
  },
} as const;

export type JevVerifierOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Below this confidence the action goes to the user even when Jev says it fits. */
  minConfidence?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

type SystemOneResponse = {
  model?: string;
  answers?: Record<string, unknown>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function isChoiceAnswer(value: unknown): value is ChoiceAnswer {
  const answer = value as ChoiceAnswer | undefined;
  return (
    answer?.type === "choice" &&
    typeof answer.choice === "string" &&
    typeof answer.confidence === "number" &&
    typeof answer.probabilities === "object"
  );
}

export class JevVerifier implements Verifier {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly minConfidence: number;
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: JevVerifierOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = options.model ?? DEFAULT_MODEL;
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetch = options.fetch ?? fetch;
  }

  describe() {
    return {
      id: "jev",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { actions: true },
    };
  }

  async reviewAction(
    request: ActionReviewRequest,
    context: AdapterContext,
  ): Promise<VerificationResult> {
    const started = performance.now();
    let model = this.model;
    const failure = (reason: string, usage?: SystemOneResponse["usage"]): VerificationResult => ({
      decision: "error",
      reason,
      model,
      latencyMs: Math.round(performance.now() - started),
      ...usageFields(usage),
    });

    let body: SystemOneResponse;
    try {
      const response = await this.fetch(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          state: {
            tool: request.toolName,
            connector: request.connectorKind,
            tool_args: request.args,
            user_task: request.userTask,
            bot: request.botDescription,
            matching_rules: request.matchingRules,
          },
          questions: { action_fit: ACTION_FIT_QUESTION },
        }),
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(this.timeoutMs)]),
      });
      if (!response.ok) return failure(`Checker returned HTTP ${response.status}.`);
      body = (await response.json()) as SystemOneResponse;
    } catch {
      return failure("Checker timed out or failed.");
    }

    model = body.model ?? model;
    const answer = body.answers?.action_fit;
    if (!isChoiceAnswer(answer)) return failure("Checker returned no decision.", body.usage);

    const unexpected = answer.probabilities.unexpected ?? (answer.choice === "unexpected" ? 1 : 0);
    const lowConfidence = answer.confidence < this.minConfidence;
    const decision = answer.choice === "unexpected" || lowConfidence ? "ask" : "pass";
    return {
      decision,
      reason:
        answer.choice === "unexpected"
          ? "Rated unexpected for this task."
          : lowConfidence
            ? "Not confident this fits the task."
            : "Rated as fitting the task.",
      probability: unexpected,
      confidence: answer.confidence,
      details: {
        question: ACTION_FIT_QUESTION.instructions,
        choice: answer.choice,
        probabilities: answer.probabilities,
        minConfidence: this.minConfidence,
      },
      model,
      latencyMs: Math.round(performance.now() - started),
      ...usageFields(body.usage),
    };
  }
}

function usageFields(usage: SystemOneResponse["usage"]) {
  const inputTokens = usage?.input_tokens;
  return {
    inputTokens,
    outputTokens: usage?.output_tokens,
    costUsd: inputTokens === undefined ? undefined : inputTokens * INPUT_USD_PER_TOKEN,
  };
}
