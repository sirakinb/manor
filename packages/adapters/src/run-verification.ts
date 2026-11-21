import type {
  ActionReviewRequest,
  AdapterContext,
  AgentRuntimeEvent,
  AutoReviewRequest,
  ClaimVerdict,
  VerificationResult,
  Verifier,
} from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";
import { recordUsage } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { AnswerSources, extractClaims } from "./answer-check.js";
import type { AutoReviewChecker } from "./auto-review.js";
import {
  answerCheckTimeoutMs,
  autoReviewTimeoutMs,
  checkerCostUsd,
  createLlmVerifier,
  isAutoReviewCheckerConfigured,
  resolveAutoReviewChecker,
} from "./auto-review.js";
import { reviewWithBackups } from "./auto-review-backups.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { findConnectedModelCredential, hasHostedModelCredits } from "./model-selection.js";
import { autoReviewCheckerProvider } from "./run-auto-review.js";
import type { RunTrust } from "./run-context.js";
import { resolveModelKey } from "./run-model.js";
import {
  isVerificationEngineId,
  JEV_ENGINE,
  jevVerifierFromEnv,
  LLM_ENGINE,
  planVerificationEngines,
  type VerificationEngineId,
} from "./verification-engines.js";

type VerificationCheckSubject = {
  checkpoint: "action" | "answer";
  subject: string;
  effectId: string | null;
};

type VerificationSetup = {
  /** Manor's answer-check settings, stored on the space's Auto Review row. */
  preference: { checkAnswers: boolean; engine: VerificationEngineId; compare: boolean };
  /** Auto Review judges actions: the approval mode is "auto". */
  reviewsActions: boolean;
  /** The approval model, then its ordered backups; empty when none is set. */
  checkers: AutoReviewChecker[];
  /** The approval role's backups, which run only on their own connection or hosted credits. */
  backups: readonly { provider: string; modelId: string }[];
  /** The member chose the approval model, so it always runs as an LLM. */
  memberChecker: boolean;
  jev: ReturnType<typeof jevVerifierFromEnv>;
  engines: ReturnType<typeof planVerificationEngines>;
};

export type RunVerification = ReturnType<typeof createRunVerification>;

/**
 * Manor: the reply check and the verification engines (LLM and Jev, with a shadow engine for
 * comparison) for one attempt. Action reviews go through here instead of upstream's reviewer
 * chain so both checkpoints share one engine plan and one verdict log.
 */
export function createRunVerification(
  deps: ExecutorDeps,
  input: {
    run: { spaceId: string; userId: string };
    runId: string;
    botId: string;
    threadId: string;
    taskPrompt: string;
    /** The run's provider context; aborting the run aborts every check. */
    context: AdapterContext;
    secrets: string[];
    trust: Pick<RunTrust, "loadApprovalModel" | "loadApprovalMode">;
  },
) {
  const { run, runId, botId, threadId, context, secrets, trust } = input;
  /** Compare-mode verdict writes still in flight; flushed before the attempt ends. */
  const pendingLogs = new Set<Promise<void>>();
  const answerSources = new AnswerSources();

  let setupPromise: Promise<VerificationSetup> | undefined;
  /** Which engines decide and shadow this run's checks; resolved once per attempt. */
  const loadSetup = () => {
    setupPromise ??= (async () => {
      const [mode, row] = await Promise.all([
        trust.loadApprovalMode(),
        deps.prisma.actionAutoReviewPreference.findUnique({
          where: { spaceId_userId: { spaceId: run.spaceId, userId: run.userId } },
          select: { checkAnswers: true, engine: true, compare: true },
        }),
      ]);
      const preference = {
        checkAnswers: row?.checkAnswers ?? false,
        engine: isVerificationEngineId(row?.engine) ? row.engine : LLM_ENGINE,
        compare: row?.compare ?? false,
      };
      const reviewsActions = mode === "auto";
      const active = reviewsActions || preference.checkAnswers;
      // The approval model role picks the LLM checker and its backups; an injected
      // Auto Review provider keeps the deployment's checker, as upstream does.
      const reviewSettings = active && !deps.autoReview ? await trust.loadApprovalModel() : null;
      const memberChecker = reviewSettings?.primarySource === "member";
      const checker: AutoReviewChecker | null = !active
        ? null
        : reviewSettings
          ? reviewSettings.primary
            ? {
                provider: reviewSettings.primary.provider,
                model: reviewSettings.primary.modelId,
                thinkingLevel: reviewSettings.primary.thinkingLevel,
                credentialId: reviewSettings.primary.credentialId,
              }
            : null
          : resolveAutoReviewChecker();
      const backups: AutoReviewChecker[] = (reviewSettings?.backups ?? []).map((choice) => ({
        provider: choice.provider,
        model: choice.modelId,
        thinkingLevel: choice.thinkingLevel,
        credentialId: choice.credentialId,
      }));
      const jev = active ? jevVerifierFromEnv() : null;
      // An injected Auto Review provider stands in for the LLM judge on action reviews.
      const llmConfigured =
        active &&
        (Boolean(deps.autoReview) ||
          memberChecker ||
          backups.length > 0 ||
          (checker
            ? isAutoReviewCheckerConfigured({}) ||
              Boolean(
                await findConnectedModelCredential(
                  deps.prisma,
                  deps.secretStore,
                  { userId: run.userId, spaceId: run.spaceId },
                  checker.provider,
                ),
              )
            : false));
      const engines = planVerificationEngines({
        selected: preference.engine,
        compare: preference.compare,
        available: { [LLM_ENGINE]: llmConfigured, [JEV_ENGINE]: Boolean(jev) },
      });
      return {
        preference,
        reviewsActions,
        checkers: checker ? [checker, ...backups] : backups,
        backups: reviewSettings?.backups ?? [],
        memberChecker,
        jev,
        engines,
      };
    })();
    return setupPromise;
  };

  const onUsage = (event: Extract<AgentRuntimeEvent, { type: "usage" }>) =>
    recordUsage(deps.prisma, event, {
      spaceId: run.spaceId,
      userId: run.userId,
      botId,
      parentRunId: runId,
      runId,
      operationId: `auto-review:${runId}`,
      operationKind: "setup",
    });

  const reviewContextFor = (timeoutMs: number): AdapterContext => ({
    operationId: `auto-review:${runId}`,
    traceId: `auto-review:${runId}`,
    spaceId: run.spaceId,
    userId: run.userId,
    botId,
    runId,
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]),
  });

  /**
   * Runs one engine for an answer check (or Jev for an action). The LLM engine tries the
   * approval model, then its backups in order; only an unavailable checker advances. A checker
   * that throws (credential or refresh failures) fails closed as "error": the check could not
   * be made.
   */
  const verifyWith = async (
    engine: VerificationEngineId,
    timeoutMs: number,
    check: (verifier: Verifier, context: AdapterContext) => Promise<VerificationResult>,
  ): Promise<VerificationResult> => {
    const { checkers, memberChecker, jev } = await loadSetup();
    const reviewContext = reviewContextFor(timeoutMs);
    if (engine === JEV_ENGINE) return check(jev!, reviewContext);
    const candidates = checkers;
    const failed = (checker: AutoReviewChecker | undefined): VerificationResult => ({
      decision: "error",
      reason: "Checker could not authenticate.",
      model: checker ? `${checker.provider}/${checker.model}` : "auto-review",
      latencyMs: 0,
    });
    const reviewOne = async (checker: AutoReviewChecker): Promise<VerificationResult> => {
      try {
        const reviewCredential = await findConnectedModelCredential(
          deps.prisma,
          deps.secretStore,
          { userId: run.userId, spaceId: run.spaceId },
          checker.provider,
          checker.model,
          { credentialId: checker.credentialId },
        );
        // A checker the member chose, pinned or listed as a backup runs only on its own
        // connection or hosted credits, never silently on another.
        if (
          (memberChecker || checker.credentialId || checker !== checkers[0]) &&
          !reviewCredential &&
          !(await hasHostedModelCredits(
            deps.prisma,
            { userId: run.userId, spaceId: run.spaceId },
            checker.provider,
          ))
        ) {
          throw new Error("Selected checker connection is unavailable");
        }
        const judgeKey = await resolveModelKey(
          deps,
          run.userId,
          run.spaceId,
          reviewCredential,
          checker.provider,
          checker.model,
          (values) => secrets.push(...values),
        );
        const verifier = createLlmVerifier({
          onUsage,
          runtime: deps.runtime,
          checker,
          apiKey: judgeKey.oauth ? undefined : judgeKey.apiKey,
          callObserver: judgeKey.callObserver,
          accountId: judgeKey.accountId,
          gatewayId: judgeKey.gatewayId,
          baseUrl: judgeKey.baseUrl,
          headers: judgeKey.headers,
          allowPrivateEndpoint: judgeKey.allowPrivateEndpoint,
          cacheCapabilities: judgeKey.cacheCapabilities,
          contextWindow: judgeKey.contextWindow,
          maxTokens: judgeKey.maxTokens,
          reasoning: judgeKey.reasoning,
          oauth: judgeKey.oauth
            ? {
                credential: judgeKey.oauth,
                persist: judgeKey.persistOAuth,
                retire: judgeKey.retireOAuth,
              }
            : undefined,
          runId,
          botId,
          threadId,
          timeoutMs: autoReviewTimeoutMs(),
        });
        return await check(verifier, reviewContext);
      } catch {
        // Auth/refresh failures must fail closed like a checker error, not fail the run.
        return failed(checker);
      }
    };
    // A deliberate ask is final; only an unavailable checker advances to the next one.
    let result = failed(candidates[0]);
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (context.signal.aborted) break;
      const key = JSON.stringify([
        candidate.provider,
        candidate.model,
        candidate.credentialId ?? null,
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      result = await reviewOne(candidate);
      if (result.decision !== "error") return result;
    }
    return result;
  };

  /**
   * One engine's verdict on an action. The LLM engine is upstream's Auto Review reviewer with
   * its ordered backups (an injected provider, a Jev or scripted deployment checker, a decision
   * model or the LLM judge); Jev is Manor's verifier. Either way a reviewer that throws or is not
   * available comes back as "error", so a person is asked.
   */
  const reviewAction = async (
    engine: VerificationEngineId,
    request: AutoReviewRequest,
  ): Promise<VerificationResult> => {
    const timeoutMs = autoReviewTimeoutMs();
    if (engine === JEV_ENGINE) {
      const actionRequest: ActionReviewRequest & { newSite?: boolean } = {
        ...request,
        matchingRules: request.matchingRules.map(
          (rule) => `${rule.effect}:${rule.matchKind}:${rule.matchValue}`,
        ),
      };
      return verifyWith(engine, timeoutMs, (verifier, reviewContext) =>
        verifier.reviewAction(actionRequest, reviewContext),
      );
    }
    const { checkers, backups, memberChecker } = await loadSetup();
    const candidates: AutoReviewChecker[] = checkers.length
      ? checkers
      : deps.autoReview
        ? [{ provider: "injected", model: "injected" }]
        : [];
    const reviewContext = reviewContextFor(timeoutMs);
    const started = performance.now();
    let used: AutoReviewChecker | undefined;
    const judge = await reviewWithBackups(
      candidates,
      async (checker) => {
        used = checker;
        const provider = await autoReviewCheckerProvider(
          deps,
          { runId, spaceId: run.spaceId, userId: run.userId, botId, threadId },
          {
            injectedReview: deps.autoReview,
            memberChecker,
            backups,
            registerSecrets: (values) => secrets.push(...values),
          },
          checker,
        );
        return provider.review(request, reviewContext);
      },
      context.signal,
    );
    // The LLM judge also reports what the call measured; other reviewers report only a verdict.
    const measured = judge as Partial<VerificationResult>;
    return {
      decision: judge.decision,
      reason: judge.reason,
      model: judge.model,
      latencyMs: Math.round(performance.now() - started),
      probability: measured.probability,
      confidence: measured.confidence,
      inputTokens: measured.inputTokens,
      outputTokens: measured.outputTokens,
      costUsd:
        used && measured.inputTokens !== undefined
          ? checkerCostUsd(used, measured.inputTokens, measured.outputTokens)
          : undefined,
    };
  };

  const verificationRow = (
    check: VerificationCheckSubject,
    engine: VerificationEngineId,
    role: "primary" | "shadow",
    result: VerificationResult,
  ) => ({
    spaceId: run.spaceId,
    userId: run.userId,
    runId,
    ...check,
    engine,
    role,
    decision: result.decision,
    reason: result.reason,
    probability: result.probability,
    confidence: result.confidence,
    details: result.details as Prisma.InputJsonValue | undefined,
    model: result.model,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  });

  /**
   * Log a verdict without holding up the run. The attempt waits for it before ending,
   * a failed insert retries once, and action replays backfill a missing shadow row.
   */
  const logShadow = (
    check: VerificationCheckSubject,
    engine: VerificationEngineId,
    review: () => Promise<VerificationResult>,
    role: "primary" | "shadow" = "shadow",
  ) => {
    const write = async () => {
      const data = verificationRow(check, engine, role, await review());
      const insert = () =>
        deps.prisma.verificationCheck.createMany({ data: [data], skipDuplicates: true });
      await insert().catch(insert);
    };
    const pending: Promise<void> = write()
      .catch((error) => getLogger().error("verification shadow log failed", error))
      .finally(() => pendingLogs.delete(pending));
    pendingLogs.add(pending);
  };

  /**
   * Check the finished reply against this attempt's tool results. Never blocks the reply:
   * it returns a note listing unsupported statements, or nothing.
   */
  const checkReply = async (
    blocks: MessageBlock[],
    // Narration already posted as its own message this turn. It is part of what the
    // bot told the user, so it is checked with the final reply.
    earlierTexts: readonly string[] = [],
  ): Promise<
    { note?: Extract<MessageBlock, { kind: "verification" }>; logVerdicts: () => void } | undefined
  > => {
    if (!answerSources.items.length) return undefined;
    const reply = [
      ...earlierTexts,
      ...blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])),
    ].join("\n");
    const claims = extractClaims(reply);
    if (!claims.length) return undefined;
    const { preference, engines } = await loadSetup();
    const primaryEngine = engines.primary;
    if (!preference.checkAnswers || !primaryEngine) return undefined;
    const request = { userTask: input.taskPrompt, claims, sources: answerSources.items };
    const checkWith = (engine: VerificationEngineId) =>
      verifyWith(engine, answerCheckTimeoutMs(), (verifier, checkContext) =>
        verifier.checkAnswer(request, checkContext),
      );
    const shadowCheck = engines.shadow ? checkWith(engines.shadow) : undefined;
    const primary = await checkWith(primaryEngine);
    const unsupported = ((primary.details?.claims ?? []) as ClaimVerdict[]).filter(
      (claim) => !claim.supported,
    );
    const check = { checkpoint: "answer", subject: "reply", effectId: null } as const;
    return {
      note:
        primary.decision === "ask" && unsupported.length
          ? { kind: "verification", unsupported: unsupported.map((claim) => claim.text) }
          : undefined,
      // Called only once the reply is saved, so a lost lease or retry never leaves
      // verdicts for a reply that does not exist.
      logVerdicts: () => {
        logShadow(check, primaryEngine, () => Promise.resolve(primary), "primary");
        if (engines.shadow && shadowCheck) {
          logShadow(check, engines.shadow, () => shadowCheck);
        }
      },
    };
  };

  return {
    loadSetup,
    verifyWith,
    reviewAction,
    verificationRow,
    logShadow,
    checkReply,
    answerSources,
    /** Waits for verdict writes still in flight; the attempt calls it before it ends. */
    flush: () => Promise.allSettled(pendingLogs),
  };
}
