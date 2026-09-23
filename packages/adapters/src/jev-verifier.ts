import type {
  ActionReviewRequest,
  AdapterContext,
  AnswerCheckRequest,
  ClaimVerdict,
  VerificationResult,
  Verifier,
} from "@rakazo/adapter-kit";

// TypeSafe System One API: https://docs.typesafe.ai/api
const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_MIN_CONFIDENCE = 0.6;
const DEFAULT_TIMEOUT_MS = 1_500;
const DEFAULT_ANSWER_TIMEOUT_MS = 6_000;
/** A claim whose yes-probability falls below this is reported as unsupported. */
const DEFAULT_MIN_SUPPORT = 0.5;
/** Keeps state well inside Jev's 32k-token budget for state plus one question. */
const MAX_SOURCE_STATE_CHARS = 60_000;
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

export const CLAIM_SUPPORT_QUESTION =
  "Is `claim` directly stated or implied by `sources` (the tool results the bot saw)?";

export type JevVerifierOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Below this confidence the action goes to the user even when Jev says it fits. */
  minConfidence?: number;
  timeoutMs?: number;
  answerTimeoutMs?: number;
  minSupport?: number;
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

const ACTION_FIT_OPTIONS = Object.keys(ACTION_FIT_QUESTION.criteria);

function isUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Anything but a known option with in-range numbers is treated as no decision (fail closed). */
function isActionFitAnswer(value: unknown): value is ChoiceAnswer {
  const answer = value as ChoiceAnswer | undefined;
  return (
    answer?.type === "choice" &&
    ACTION_FIT_OPTIONS.includes(answer.choice) &&
    isUnitNumber(answer.confidence) &&
    typeof answer.probabilities === "object" &&
    answer.probabilities !== null &&
    ACTION_FIT_OPTIONS.every((option) => isUnitNumber(answer.probabilities[option]))
  );
}

export class JevVerifier implements Verifier {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly minConfidence: number;
  private readonly timeoutMs: number;
  private readonly answerTimeoutMs: number;
  private readonly minSupport: number;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: JevVerifierOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = options.model ?? DEFAULT_MODEL;
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.answerTimeoutMs = options.answerTimeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS;
    this.minSupport = options.minSupport ?? DEFAULT_MIN_SUPPORT;
    this.fetch = options.fetch ?? fetch;
  }

  describe() {
    return {
      id: "jev",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { actions: true, answers: true },
    };
  }

  /** One System One call; returns the parsed body or a failure reason, both timed. */
  private async ask(
    state: unknown,
    questions: Record<string, unknown>,
    timeoutMs: number,
    context: AdapterContext,
  ): Promise<{ body?: SystemOneResponse; failure?: string; latencyMs: number }> {
    const started = performance.now();
    const latencyMs = () => Math.round(performance.now() - started);
    try {
      const response = await this.fetch(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: this.model, state, questions }),
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (!response.ok) {
        return { failure: `Checker returned HTTP ${response.status}.`, latencyMs: latencyMs() };
      }
      return { body: (await response.json()) as SystemOneResponse, latencyMs: latencyMs() };
    } catch {
      return { failure: "Checker timed out or failed.", latencyMs: latencyMs() };
    }
  }

  async reviewAction(
    request: ActionReviewRequest,
    context: AdapterContext,
  ): Promise<VerificationResult> {
    const { body, failure, latencyMs } = await this.ask(
      {
        tool: request.toolName,
        connector: request.connectorKind,
        tool_args: request.args,
        user_task: request.userTask,
        bot: request.botDescription,
        matching_rules: request.matchingRules,
      },
      { action_fit: ACTION_FIT_QUESTION },
      this.timeoutMs,
      context,
    );
    const model = body?.model ?? this.model;
    const answer = body?.answers?.action_fit;
    if (!isActionFitAnswer(answer)) {
      return {
        decision: "error",
        reason: failure ?? "Checker returned no decision.",
        model,
        latencyMs,
        ...usageFields(body?.usage),
      };
    }

    const unexpected = answer.probabilities.unexpected!;
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
      latencyMs,
      ...usageFields(body?.usage),
    };
  }

  async checkAnswer(
    request: AnswerCheckRequest,
    context: AdapterContext,
  ): Promise<VerificationResult> {
    let budget = MAX_SOURCE_STATE_CHARS;
    const sources = request.sources.flatMap((source) => {
      const content = source.content.slice(0, Math.max(0, budget));
      budget -= content.length;
      return content ? [{ tool: source.tool, content }] : [];
    });
    const questions = Object.fromEntries(
      request.claims.map((claim, index) => [
        `claim_${index}`,
        { type: "noul", instructions: { claim, question: CLAIM_SUPPORT_QUESTION } },
      ]),
    );
    const { body, failure, latencyMs } = await this.ask(
      { user_task: request.userTask, sources },
      questions,
      this.answerTimeoutMs,
      context,
    );
    const model = body?.model ?? this.model;
    const support = request.claims.map((_claim, index) => {
      const answer = body?.answers?.[`claim_${index}`] as { type?: string; noul?: unknown };
      return answer?.type === "noul" && isUnitNumber(answer.noul) ? answer.noul : undefined;
    });
    if (!support.every((value) => value !== undefined)) {
      return {
        decision: "error",
        reason: failure ?? "Checker returned no decision.",
        model,
        latencyMs,
        ...usageFields(body?.usage),
      };
    }

    const claims: ClaimVerdict[] = request.claims.map((text, index) => ({
      text,
      probability: support[index],
      supported: support[index]! >= this.minSupport,
    }));
    const unsupported = claims.filter((claim) => !claim.supported).length;
    return {
      decision: unsupported ? "ask" : "pass",
      reason: unsupported
        ? `${unsupported} of ${claims.length} statements not supported by tool results.`
        : "Every statement is supported by tool results.",
      probability: 1 - Math.min(...(support as number[])),
      details: { question: CLAIM_SUPPORT_QUESTION, claims, minSupport: this.minSupport },
      model,
      latencyMs,
      ...usageFields(body?.usage),
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
