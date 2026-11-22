import type { AutoReviewRequest } from "@rakazo/adapter-kit";
import type { connectorKindFromToolName, resolveActionApprovalForTools } from "@rakazo/core";
import {
  applyJudgeDecision,
  BACKGROUND_HELPER_TRIGGER,
  HELPER_RESULT_TRIGGER,
  lastingWriteKind,
  redactSecrets,
} from "@rakazo/core";
import { ownComputerReviewArgs, redactToolArgsForReview } from "../../approvals/auto-review.js";
import { changedTextReviewArgs } from "../../approvals/changed-text-review-args.js";
import type { VerificationEngineId } from "../../verification-engines.js";
import type { RunContext } from "../assembly/run-context.js";
import { currentRoutinePrompt, reviewOwnerContext } from "./run-review-context.js";
import { auditToolCall } from "./run-tool-audit.js";
import type { AppliedEffect } from "./run-tool-gate.js";

/** A gated call the approval model is about to judge, with what decides how it is judged. */
export type ToolReview = {
  name: string;
  args: Record<string, unknown>;
  connectorKind: ReturnType<typeof connectorKindFromToolName>;
  /** A URL to a site the run was not given, judged on its own against the owner's words. */
  newSiteUrl: string | undefined;
  savedContextWrite: boolean;
  ownComputerAction: boolean;
  /** The page a page action types into, as the gate judged it; none when it may have changed. */
  pageUrl: string | undefined;
  matchingRules: ReturnType<typeof resolveActionApprovalForTools>["matchingRules"];
  gated: boolean;
  applied: AppliedEffect | undefined;
  /**
   * Manor: the verification engine that decides and the one that shadows it for comparison
   * (see run-verification.ts). The LLM engine is upstream's reviewer chain with its backups.
   */
  engines: { primary?: VerificationEngineId; shadow?: VerificationEngineId };
};

/** Runs whose task is the product's own prompt: a new bot's intro, and the wrap-up after a call. */
const PRODUCT_PROMPT_TRIGGERS = new Set(["created", "call_end"]);

/** A helper's brief is the bot's, so its review is judged on the owner's words instead. */
function delegatedRun(ctx: RunContext): boolean {
  return ctx.run.trigger === BACKGROUND_HELPER_TRIGGER || ctx.run.trigger === HELPER_RESULT_TRIGGER;
}

/**
 * What a review judges. A new site, a write that outlives the run (a memory or skill save, a
 * routine, the bot's own instructions), or an action on the bot's own computer after outside
 * content, is judged on the owner's own words only: the task prompt of a webhook, helper or
 * bot-started run carries text someone else wrote, which must not authorize a write that later
 * runs with the owner's trust. A new bot's intro and a call's wrap-up keep their task, the
 * product's own prompt. A follow-up's task is a fixed "continue" prompt, so the owner's latest
 * words stand in for it.
 */
async function reviewRequest(ctx: RunContext, review: ToolReview): Promise<AutoReviewRequest> {
  const { bot, run } = ctx;
  const { name, args, connectorKind, newSiteUrl } = review;
  const botDescription = redactSecrets(`${bot.name}\n${bot.description}`, ctx.secrets);
  // A webhook run's task prompt carries the delivery, which someone else wrote, so the checker
  // gets only the owner's routine (reviewToolCall asks a person when there is none).
  const ownerWordsOnly =
    Boolean(newSiteUrl) ||
    review.ownComputerAction ||
    run.trigger === "webhook" ||
    delegatedRun(ctx) ||
    (!PRODUCT_PROMPT_TRIGGERS.has(run.trigger) &&
      Boolean(
        lastingWriteKind({ toolName: name, args, savedContextWrite: review.savedContextWrite }),
      ));
  const continuation = run.trigger === "follow_up" || run.trigger === "messaging";
  const userTask = ownerWordsOnly
    ? await ctx.trust.loadOwnerWords()
    : (continuation && (await ctx.trust.loadOwnerWords()).trim()) || ctx.task.prompt;
  const redacted = redactToolArgsForReview(args, ctx.secrets);
  // Targets come from the whole call: an edit's changes list addresses it removes or keeps too.
  const targetArgs = newSiteUrl
    ? { url: redactSecrets(newSiteUrl, ctx.secrets) }
    : review.ownComputerAction
      ? ownComputerReviewArgs(
          name,
          redacted,
          review.pageUrl && redactSecrets(review.pageUrl, ctx.secrets),
        )
      : redacted;
  const reviewArgs =
    targetArgs === redacted
      ? changedTextReviewArgs(name, redacted, await currentRoutinePrompt(ctx, name, args))
      : targetArgs;
  return {
    toolName: name,
    connectorKind,
    args: reviewArgs,
    userTask: redactSecrets(userTask, ctx.secrets),
    botDescription,
    matchingRules: review.matchingRules,
    ...(newSiteUrl ? { newSite: true } : {}),
    ...(review.savedContextWrite ? { savedContextWrite: true } : {}),
    ...(review.ownComputerAction ? { ownComputerAction: true } : {}),
    ...(await reviewOwnerContext(ctx, targetArgs, !newSiteUrl && !review.savedContextWrite)),
  };
}

/** One engine's verdict on a call. A reviewer that throws counts as "could not check". */
async function reviewWith(ctx: RunContext, review: ToolReview, engine: VerificationEngineId) {
  return ctx.verification.reviewAction(
    engine,
    await reviewRequest(ctx, review),
    review.applied?.effect.id,
  );
}

const actionCheck = (name: string, effectId: string) =>
  ({ checkpoint: "action", subject: name, effectId }) as const;

/**
 * Run the selected verification engine on a call and store its verdict on the effect, with
 * its comparison row in the same interactive transaction. The shadow engine is only logged.
 * Returns nothing when there is no engine or the run was cancelled.
 */
export async function reviewToolCall(
  ctx: RunContext,
  review: ToolReview,
): Promise<{ reason: string | undefined; decision: "ask" | "allow" } | undefined> {
  const { deps, context } = ctx;
  const { primary: primaryEngine, shadow: shadowEngine } = review.engines;
  if (!primaryEngine) return;
  // With no routine to judge a webhook run against, a person decides. Older helpers and deleted
  // origins cannot establish authorization from their brief either.
  if (
    (ctx.run.trigger === "webhook" || delegatedRun(ctx)) &&
    !(await ctx.trust.loadOwnerWords()).trim()
  )
    return { reason: undefined, decision: "ask" };
  // The shadow only feeds comparison, so it must never delay the selected verdict.
  const shadowReview = shadowEngine ? reviewWith(ctx, review, shadowEngine) : undefined;
  const primary = await reviewWith(ctx, review, primaryEngine);
  // Cancellation must not write a review the next attempt would reuse.
  if (context.signal.aborted) return;
  const verdict = {
    reason: primary.reason,
    decision: applyJudgeDecision({ decision: primary.decision, consequential: review.gated }),
  };
  const { applied } = review;
  if (!applied) {
    await auditAutoReview(
      ctx,
      review.name,
      applied,
      primary.decision,
      primary.model,
      primaryEngine,
    );
    return verdict;
  }
  const effectId = applied.effect.id;
  // Replays trust the stored decision, so its comparison row must commit with it.
  // Interactive, because row-level security rejects a batch transaction in the
  // run's tenant context.
  await deps.prisma.$transaction(async (tx) => {
    await tx.externalEffect.update({
      where: { id: effectId },
      data: {
        reviewDecision: primary.decision,
        reviewReason: primary.reason,
        reviewModel: primary.model,
      },
    });
    await tx.verificationCheck.create({
      data: ctx.verification.verificationRow(
        actionCheck(review.name, effectId),
        primaryEngine,
        "primary",
        primary,
      ),
    });
  });
  await auditAutoReview(ctx, review.name, applied, primary.decision, primary.model, primaryEngine);
  if (shadowEngine && shadowReview) {
    ctx.verification.logShadow(
      actionCheck(review.name, effectId),
      shadowEngine,
      () => shadowReview,
    );
  }
  return verdict;
}

/** A replayed decision has no shadow row when the first attempt ended before logging it. */
export async function backfillShadowReview(ctx: RunContext, review: ToolReview) {
  const shadowEngine = review.engines.shadow;
  const { applied } = review;
  if (!applied || !shadowEngine) return;
  const logged = await ctx.deps.prisma.verificationCheck.count({
    where: { effectId: applied.effect.id, engine: shadowEngine },
  });
  if (!logged) {
    ctx.verification.logShadow(actionCheck(review.name, applied.effect.id), shadowEngine, () =>
      reviewWith(ctx, review, shadowEngine),
    );
  }
}

function auditAutoReview(
  ctx: RunContext,
  tool: string,
  applied: AppliedEffect | undefined,
  decision: string,
  model: string | undefined,
  /** Manor: which verification engine judged the call (its model is the actor label). */
  engine: VerificationEngineId,
): Promise<void> {
  return auditToolCall(
    ctx,
    tool,
    decision === "error" ? "failure" : "success",
    { effectId: applied?.effect.id, decision, engine },
    { action: "approval.auto_reviewed", actor: { type: "system", label: model } },
  );
}
