import type { AgentToolExecutionObserver, ConnectorCall, ToolBatch } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import {
  applyJudgeDecision,
  batchActions,
  connectorKindFromToolName,
  connectorReadRequiresApproval,
  connectorToolRequiresApproval,
  decisiveActionApprovalRules,
  displayName,
  humanizeToolName,
  isLocalComputerMutatingTool,
  newSiteOutcome,
  outboundSiteGate,
  planActionGate,
  redactSecrets,
  repeatsDeniedAction,
  resolveActionApprovalForTools,
  SITE_SENDING_TOOLS,
  toolRequiresApproval,
  toolRequiresExplicitApproval,
  unattendedTriggerToolRequiresApproval,
} from "@rakazo/core";
import { normalizedHttpUrl, urlSite } from "@rakazo/core/egress";
import { approvalEffectKey, toolEffectIdempotencyKey } from "@rakazo/core/node/approval-effect-key";
import type { AuditEventInput } from "@rakazo/db";
import { recordAuditEvent, runSecretKind } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { FleetCardSummary } from "./approval-ask.js";
import { buildApprovalAskBlock, MAX_FETCH_URL_LENGTH } from "./approval-ask.js";
import {
  boundDirectApprovalDetails,
  DENIED_ACTION_ERROR,
  resolveDuplicateEffectGate,
  settleUncertainEffect,
  uncertainEffectResult,
} from "./approval-effect.js";
import { redactToolArgsForReview } from "./auto-review.js";
import { RAKAZO_DOCS_URLS } from "./builtin-skills.js";
import { CATALOG_LOAD, CATALOG_SEARCH } from "./lazy-tool-catalog.js";
import { paidRequestEffect } from "./paid-request.js";
import { PURCHASE_CHECKED_TOOLS, purchaseApprovalOf } from "./purchase-gate.js";
import type { RunContext } from "./run-context.js";
import {
  isRunTainted,
  nextMutatingEffectOccurrence,
  pauseForApproval,
  pauseForSecret,
  persistTurnCheckpoint,
} from "./run-context.js";
import {
  CATALOG_APPROVAL_TOOL,
  claimEffect,
  completeEffect,
  recordEffect,
  uncertainEffectError,
} from "./run-effects.js";
import { renewRunLease } from "./run-lifecycle.js";
import { notifyRun } from "./run-notifications.js";
import { resolveCompletedSecretLeftover } from "./run-secret.js";
import type { ToolRequest } from "./run-tool-request.js";
import { BUILTIN_AGENT_TOOL_NAMES, READ_ONLY_AGENT_TOOLS } from "./run-tool-selection.js";
import { callMediaTool } from "./run-tools-files.js";
import { USER_COMPUTER_TOOLS, userComputerGate } from "./run-tools-user-computer.js";
import { connectorTrustKeys } from "./run-trust.js";
import { watchFromTool } from "./schedule-tools.js";
import { argumentGiven } from "./update-bot-patch.js";
import type { VerificationEngineId } from "./verification-engines.js";

export type AppliedEffect = Awaited<ReturnType<typeof recordEffect>>;

type ApprovalCard = {
  reviewReason: string | undefined;
  summary: FleetCardSummary | undefined;
  batch: ToolBatch | undefined;
  /** Manor: a mandatory approval on This Mac can only be allowed once. */
  allowOnceOnly?: boolean;
};

/** A tool call that passed its approval gate, as tool handlers receive it. */
export interface ToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly executionId: string;
  readonly observer: AgentToolExecutionObserver | undefined;
  readonly connectorCall: ConnectorCall;
  /** Idempotency key of this call's effect; also the delivery key of what it sends. */
  readonly effectKey: string;
  /** The effect recorded for this call. Read-only tools that need no approval have none. */
  readonly applied: AppliedEffect | undefined;
  readonly nextApprovedTool: string | undefined;
  /** A gated call that policy or the reviewer allowed without asking. */
  readonly bypassApproval: boolean;
  /** This call moved its effect to executing. request_secret can hand the claim back. */
  claimedEffect: boolean;
  /** Store the result on the effect; false when it could not be stored. */
  readonly persistEffectResult: (result: unknown) => Promise<boolean>;
  /** Store the result and return it, or an uncertain-effect result when storing failed. */
  readonly finish: (result: unknown) => Promise<unknown>;
  /** Claim the effect to execute it, or return what an earlier attempt already settled. */
  readonly claimOrReturn: (from: "approved" | "intended") => Promise<unknown | undefined>;
}

export type ToolHandler = (ctx: RunContext, call: ToolCall) => Promise<unknown>;
export type ToolHandlers = Record<string, ToolHandler>;

type GateOutcome = { result: unknown } | { call: ToolCall };

type ToolReview = {
  name: string;
  args: Record<string, unknown>;
  connectorKind: ReturnType<typeof connectorKindFromToolName>;
  newSite: boolean;
  fetchUrl: string | undefined;
  matchingRules: ReturnType<typeof resolveActionApprovalForTools>["matchingRules"];
  gated: boolean;
  applied: AppliedEffect | undefined;
  /** Manor: the engine that decides and the one that shadows it for comparison. */
  engines: { primary?: VerificationEngineId; shadow?: VerificationEngineId };
};

/**
 * Decide whether a resolved call runs, asks the owner, is reviewed, or is refused, and record
 * the effect it claims. Returns the result to hand back when the call stops here.
 */
export async function gateToolCall(
  ctx: RunContext,
  request: ToolRequest,
  observer: AgentToolExecutionObserver | undefined,
): Promise<GateOutcome> {
  const { deps, run, runId, context } = ctx;
  const { name, executionId, connectorCall, resolvedTool, nextApprovedTool, approvedEffectKey } =
    request;
  const { replayEffectToolName } = request;
  let { args, effectRequest } = request;
  const viaConnector = !BUILTIN_AGENT_TOOL_NAMES.has(name);
  // Declared effect of the operation this call dispatches (installed API method and
  // flag). Install config is immutable per route resource, so it cannot drift before
  // execute; a catalog call uses the tool it was just resolved to.
  const connectorTool = viaConnector ? (resolvedTool ?? ctx.tools.connector.get(name)) : undefined;
  const declaredReadOnly = connectorTool?.readOnly;
  // A batch tool names the actions it runs in its arguments, so rules and the read/write
  // check look at each action, never the batch tool. An entry naming no action asks.
  const batch = connectorTool?.batch ? batchActions(connectorTool.batch, args) : undefined;
  const unidentifiedAction = Boolean(batch && !batch.complete);
  const approvalName = connectorCall.route?.connectionId ? connectorCall.route.toolName : name;
  const approvalToolNames = batch?.actions.length ? batch.actions : [approvalName];
  // Search and load return a list or a schema. They never call the connector.
  const catalogControlRead =
    !connectorCall.route?.connectionId &&
    !connectorCall.route?.resourceId &&
    (connectorCall.route?.toolName === CATALOG_SEARCH ||
      connectorCall.route?.toolName === CATALOG_LOAD);
  // A batch tool declared as a write makes each of its actions one.
  const declaredReadOnlyFor = (toolName: string) =>
    toolName === approvalName || toolName === name || declaredReadOnly === false
      ? declaredReadOnly
      : ctx.tools.connector.get(toolName)?.readOnly;
  const requiresUnattendedApproval =
    !catalogControlRead &&
    ((unidentifiedAction && run.trigger === "webhook") ||
      approvalToolNames.some((toolName) =>
        unattendedTriggerToolRequiresApproval(
          run.trigger,
          toolName,
          viaConnector,
          declaredReadOnlyFor(toolName),
        ),
      ));
  const connectorProviders = ctx.tools.connectedPlugins.map((plugin) => plugin.provider);
  const connectorKind = connectorKindFromToolName(approvalName, connectorProviders);
  // paid_request with only a purchase id sends the request its approval already named.
  const sendsToSite =
    SITE_SENDING_TOOLS.has(name) && (name === "web_fetch" || args.url !== undefined);
  const fetchUrl = sendsToSite ? normalizedHttpUrl(String(args.url ?? "")) : undefined;
  const fetchSite = fetchUrl ? urlSite(fetchUrl) : undefined;
  if (sendsToSite && !fetchSite) return { result: { error: "url must be an http(s) URL" } };
  if (fetchUrl && fetchUrl.length > MAX_FETCH_URL_LENGTH)
    return { result: { error: `url must be at most ${MAX_FETCH_URL_LENGTH} characters` } };
  // The card, the stored effect and the request all use the URL the gate checked.
  if (fetchUrl) {
    args = { ...args, url: fetchUrl };
    effectRequest = name === "paid_request" ? paidRequestEffect(args) : args;
  }
  const connectorTrusts = connectorTrustKeys(
    batch?.actions,
    connectorCall.route,
    connectorKind,
    connectorProviders,
  );
  const siteGate =
    fetchUrl && fetchSite
      ? outboundSiteGate({
          site: fetchSite,
          trusted:
            ctx.trust.searchResultUrls.has(fetchUrl) ||
            (name === "web_fetch" && RAKAZO_DOCS_URLS.includes(fetchUrl)) ||
            (await ctx.trust.loadTrustedSites()).has(fetchSite),
          rules: await ctx.trust.loadApprovalRules(),
        })
      : "allow";
  const watch = name === "schedule_create" ? watchFromTool(args.watch) : undefined;
  // A tool watch repeats its read unattended, so it passes the read check that call would now.
  const watchedTool = watch?.kind === "tool" ? watch.tool : undefined;
  const readTrusts = watchedTool
    ? connectorTrustKeys(
        undefined,
        ctx.tools.connector.get(watchedTool)?.route,
        connectorKindFromToolName(watchedTool, connectorProviders),
        connectorProviders,
      )
    : viaConnector &&
        !unidentifiedAction &&
        (catalogControlRead ||
          approvalToolNames.every(
            (toolName) => !connectorToolRequiresApproval(toolName, declaredReadOnlyFor(toolName)),
          ))
      ? connectorTrusts
      : undefined;
  const connectorReadGated =
    readTrusts !== undefined &&
    connectorReadRequiresApproval({
      tainted: await isRunTainted(ctx),
      connectorTrusted: await ctx.trust
        .loadTrustedConnectors()
        .then((trusted) => readTrusts.every((trust) => trusted.has(trust))),
    });
  // This schedules unattended shell execution; require a person to approve
  // the command once, rather than letting an allow rule or reviewer schedule it.
  const commandWatch = watch?.kind === "command";
  // A routine's prompt counts as the owner's words when it runs, so the sites it names are
  // ones its runs may fetch. Once outside content entered this run, a routine naming a
  // site this run was not given needs a person: a reviewer would judge it on this run's
  // context, and passing it would trust the site for every later run.
  const scheduleNamesNewSite =
    (name === "schedule_create" ||
      name === "create_child_routine" ||
      (name === "schedule_update" && Boolean(args.prompt))) &&
    (await isRunTainted(ctx)) &&
    (await ctx.trust.routineNamesNewSite(String(args.prompt ?? "")));
  const { purchase, cardUse } = request;
  // Typing a saved card is approved like a purchase: every time, by a person.
  const paying = Boolean(purchase) || Boolean(cardUse);
  // Manor: changing a page shared by link changes what people outside the space see.
  const editsSharedPage = name === "save_page" && (await savesSharedPage(ctx, args));
  const requiresApprovalByDefault =
    request.heldForApproval ||
    paying ||
    editsSharedPage ||
    commandWatch ||
    requiresUnattendedApproval ||
    siteGate === "new" ||
    unidentifiedAction ||
    (!catalogControlRead &&
      approvalToolNames.some((toolName) =>
        toolRequiresApproval(toolName, viaConnector, declaredReadOnlyFor(toolName), {
          computerKind: ctx.computer.kind,
        }),
      ));
  // A gated read still fails closed when its review errors, and keeps its approval key.
  const gated = requiresApprovalByDefault || connectorReadGated;
  const requiresMandatoryApproval =
    paying ||
    commandWatch ||
    scheduleNamesNewSite ||
    requiresUnattendedApproval ||
    toolRequiresExplicitApproval(name, { computerKind: ctx.computer.kind });
  // Never ask runs everything else: only another owner's connection could have been steered into it.
  // Manor: so could a change on This Mac, the owner's own laptop, which Never ask refused before.
  const guardedInNeverAsk =
    name === "respond_agent_connection" ||
    editsSharedPage ||
    (ctx.computer.kind === "local" && isLocalComputerMutatingTool(name));
  const resolvedRules = resolveActionApprovalForTools({
    tools: approvalToolNames.map((toolName) => ({
      name: toolName,
      aliases: toolName === approvalName && approvalName !== name ? [name] : undefined,
      connectorKind:
        toolName === approvalName
          ? connectorKind
          : connectorKindFromToolName(toolName, connectorProviders),
      readOnly: declaredReadOnlyFor(toolName),
    })),
    wrapper: batch ? { name, connectorKind } : undefined,
    site: fetchSite,
    rules: await ctx.trust.loadApprovalRules(),
  });
  const approvalResolved =
    unidentifiedAction && resolvedRules.decision === "allow"
      ? { ...resolvedRules, decision: "ask" as const }
      : resolvedRules;
  const mode = await ctx.trust.loadApprovalMode();
  const reviewable = mode === "auto" && !requiresMandatoryApproval;
  // Manor: action reviews run on the verification engines (see run-verification.ts).
  const verification = reviewable ? await ctx.verification.loadSetup() : undefined;
  const engines: ToolReview["engines"] = verification?.reviewsActions ? verification.engines : {};
  const checkerConfigured = reviewable && Boolean(engines.primary);
  const steerable =
    guardedInNeverAsk && mode === "never"
      ? !ctx.source.ownerStartedRun || (await isRunTainted(ctx))
      : undefined;
  const gatePlan = USER_COMPUTER_TOOLS.has(name)
    ? await userComputerGate(ctx, approvalResolved.decision === "deny", name, args)
    : planActionGate({
        resolved: approvalResolved,
        mode,
        mandatory: requiresMandatoryApproval,
        steerable,
        consequential: requiresApprovalByDefault,
        reviewOnly: connectorReadGated,
        checkerConfigured,
        newDestination: siteGate === "new",
        purchase: paying,
      });
  // Manor: Never ask still refuses a shared page change that outside content could have asked for.
  const plan = editsSharedPage && steerable && gatePlan === "allow" ? "deny" : gatePlan;
  // Nobody is there to approve a purchase a webhook run reaches.
  if (paying && run.trigger === "webhook" && plan !== "deny") {
    await auditToolCall(ctx, name, "denied", { reason: "purchase_unattended" });
    return {
      result: {
        error:
          "This would complete a purchase, which needs the user's approval, and a webhook run cannot ask. Don't retry; tell the user.",
      },
    };
  }
  if (plan === "deny") {
    await auditToolCall(ctx, name, "denied", {
      reason: approvalResolved.decision === "deny" ? "rule" : "never_asks",
    });
    return {
      result: {
        error:
          approvalResolved.decision === "deny"
            ? `${name} is blocked in this space${blockingRuleSuffix(approvalResolved)}. Don't try it another way; tell the user it's blocked.`
            : `${name} needs the owner's approval because it could have been asked for by someone else, and this space never asks. Don't retry; tell the user.`,
      },
    };
  }
  let reviewReason: string | undefined;
  let gateDecision: "ask" | "allow" = plan === "ask" ? "ask" : "allow";
  const needsApprovalEarly = plan === "ask" || plan === "judge";
  // A resumed approval keeps its key even if "Always allow" changed the policy.
  const usesApprovalKey =
    nextApprovedTool || name === "request_secret" || needsApprovalEarly || gated;
  // Count before choosing a key so an approved replay (occurrence 0 / base
  // key) cannot collide with a later identical-args call in this attempt.
  // request_secret stays single-use: retries must reuse the same card. A code is the exception:
  // a wrong or expired one needs a new card, so each request counts, and a retry still finds its
  // own through the saved turn.
  const occurrence =
    (name === "request_secret" && args.oneTimeCode === undefined) || name === "connect_app"
      ? 0
      : nextMutatingEffectOccurrence(
          ctx,
          replayEffectToolName,
          args,
          executionId,
          approvedEffectKey,
        );
  // An approved replay claims the row the user approved. A derived key can differ
  // (another call's occurrence count), which would ask again and strand the approval.
  const effectKey =
    approvedEffectKey ??
    (usesApprovalKey && occurrence === 0
      ? approvalEffectKey(runId, replayEffectToolName, args)
      : toolEffectIdempotencyKey(runId, replayEffectToolName, args, occurrence));
  // Connector read-only hints must not bypass approval, review, or replay decisions.
  // A fetch to a new site is gated like any action, so it needs an effect to approve.
  const applied =
    READ_ONLY_AGENT_TOOLS.has(name) &&
    siteGate !== "new" &&
    nextApprovedTool !== name &&
    !approvedEffectKey
      ? undefined
      : await recordEffect(
          deps,
          run,
          replayEffectToolName,
          effectKey,
          effectRequest,
          executionId,
          ctx.state.effects.consumedIds,
          batch && (batch.complete ? batch.actions : []),
        );

  // Refuse a repeat of a tool the user denied earlier in this run. Refusals carry a result,
  // so only real denies match. A stored row is checked only while it still waits for an
  // answer. web_fetch and secret_request target one site per call; request_secret and
  // connect_app name their own target.
  // Browsing goes on after a denied purchase: a purchase is checked against earlier denied purchases
  // on the same site, and other page work against earlier denied page work that bought nothing.
  const pageAction = PURCHASE_CHECKED_TOOLS.has(name);
  const repeatChecked =
    applied &&
    (!applied.duplicate || applied.effect.status === "intended") &&
    !["web_fetch", "secret_request", "request_secret", "connect_app"].includes(name);
  const deniedEarlier = repeatChecked
    ? (
        await deps.prisma.externalEffect.findMany({
          where: { runId, status: "denied", kind: replayEffectToolName },
          select: { request: true, result: true },
        })
      ).flatMap((effect) =>
        effect.result == null &&
        (!pageAction ||
          purchaseApprovalOf(
            (effect.request as { purchaseApproval?: unknown } | null)?.purchaseApproval,
          )?.site === purchase?.site)
          ? [
              boundDirectApprovalDetails(effect.request, CATALOG_APPROVAL_TOOL)?.args ??
                effect.request,
            ]
          : [],
      )
    : [];
  if (
    applied &&
    repeatsDeniedAction({ toolName: replayEffectToolName, args, denied: deniedEarlier })
  ) {
    await deps.prisma.externalEffect.updateMany({
      where: { id: applied.effect.id, status: "intended" },
      data: { status: "denied", result: { refused: "repeat" } },
    });
    return { result: { error: DENIED_ACTION_ERROR } };
  }

  const review: ToolReview = {
    name,
    args,
    connectorKind,
    newSite: siteGate === "new",
    fetchUrl,
    matchingRules: approvalResolved.matchingRules,
    gated,
    applied,
    engines,
  };

  const runAutoReview = async () => {
    const judged = await reviewToolCall(ctx, review);
    if (!judged) return;
    reviewReason = judged.reason;
    gateDecision = judged.decision;
  };

  if (applied && plan === "judge" && engines.primary) {
    if (!applied.duplicate) {
      await runAutoReview();
    } else {
      const priorDecision = applied.effect.reviewDecision;
      if (priorDecision) await backfillShadowReview(ctx, review);
      if (priorDecision === "ask" || priorDecision === "error") {
        reviewReason =
          typeof applied.effect.reviewReason === "string" ? applied.effect.reviewReason : undefined;
        gateDecision = "ask";
      } else if (priorDecision === "pass") {
        reviewReason =
          typeof applied.effect.reviewReason === "string" ? applied.effect.reviewReason : undefined;
        gateDecision = "allow";
      } else {
        await runAutoReview();
      }
    }
  } else if (applied?.duplicate && plan === "ask") {
    gateDecision = "ask";
  }
  if (context.signal.aborted) return { result: pauseForApproval(ctx) };
  if (
    siteGate === "new" &&
    newSiteOutcome({ trigger: run.trigger, decision: gateDecision }) === "deny"
  ) {
    if (applied) {
      await deps.prisma.externalEffect.updateMany({
        where: { id: applied.effect.id, status: "intended" },
        data: { status: "denied" },
      });
    }
    return {
      result: { error: `Fetching ${fetchSite} needs approval, and a webhook run cannot ask.` },
    };
  }

  const needsApproval = gateDecision === "ask";
  const call = createToolCall(ctx, {
    name,
    args,
    executionId,
    observer,
    connectorCall,
    effectKey,
    applied,
    nextApprovedTool,
    bypassApproval: gateDecision === "allow" && gated,
  });
  const card = {
    reviewReason: editsSharedPage
      ? [SHARED_PAGE_CARD_NOTE, reviewReason].filter(Boolean).join("\n")
      : reviewReason,
    summary: request.fleetSummary,
    batch: connectorTool?.batch,
    allowOnceOnly: requiresMandatoryApproval && ctx.computer.kind === "local",
  };

  if (applied?.duplicate) {
    const gate = resolveDuplicateEffectGate(applied.effect, name);
    if (gate.action === "return") {
      if (name === "request_secret") {
        const replacementSecret = await deps.prisma.secret.findFirst({
          where: {
            spaceId: run.spaceId,
            userId: run.userId,
            kind: runSecretKind(runId),
          },
          select: { id: true, createdAt: true },
        });
        if (!replacementSecret) return { result: gate.result };
        // Crash between persist and delete leaves the same OTP row. Do not
        // resubmit it to the connector; only newer rows are replacements.
        const effectUpdatedAt = applied.effect.updatedAt;
        if (
          !(effectUpdatedAt instanceof Date) ||
          resolveCompletedSecretLeftover({
            secretCreatedAt: replacementSecret.createdAt,
            effectUpdatedAt,
          }) === "drop_leftover"
        ) {
          await deps.prisma.secret.delete({
            where: { id: replacementSecret.id },
          });
          return { result: gate.result };
        }
      } else {
        return { result: gate.result };
      }
    }
    if (gate.action === "paused") {
      if (name === "request_secret") {
        const current = await deps.prisma.run.findUnique({
          where: { id: runId },
          select: { status: true },
        });
        if (current?.status === "waiting_input") {
          return { result: pauseForSecret(ctx) };
        }
        // An intended secret request resumes protected entry below, including
        // recovery after action approval but before the card was committed.
      } else if (!needsApproval) {
        const early = await call.claimOrReturn("intended");
        if (early !== undefined) return { result: early };
      } else {
        const current = await deps.prisma.run.findUnique({
          where: { id: runId },
          select: { status: true },
        });
        if (current?.status === "waiting_input") {
          return { result: pauseForApproval(ctx) };
        }
        return { result: await requestApproval(ctx, call, card) };
      }
    } else if (gate.action === "uncertain") {
      return { result: await settleToolUncertainty(ctx, call, applied.effect.id, gate.toolName) };
    } else if (gate.action === "execute") {
      const early = await call.claimOrReturn("approved");
      if (early !== undefined) return { result: early };
    }
  } else if (needsApproval && applied) {
    return { result: await requestApproval(ctx, call, card) };
  } else if (call.bypassApproval && applied) {
    const early = await call.claimOrReturn("intended");
    if (early !== undefined) return { result: early };
  }
  // Past the gate: this destination is now one the run was given. A search result's exact
  // URL trusts only that URL, never the rest of its site.
  if (fetchSite && siteGate === "new") (await ctx.trust.loadTrustedSites()).add(fetchSite);
  if (viaConnector) {
    const trusted = await ctx.trust.loadTrustedConnectors();
    for (const trust of connectorTrusts) trusted.add(trust);
  }
  return { call };
}

const SHARED_PAGE_CARD_NOTE = "This page is shared by link: anyone with the link sees the change.";

/** Manor: a save_page call that changes a page currently shared by link. Reads ask nothing. */
async function savesSharedPage(ctx: RunContext, args: Record<string, unknown>) {
  const changes = ["source", "edits", "title"].some((key) =>
    key === "edits" && Array.isArray(args.edits) ? args.edits.length > 0 : argumentGiven(args[key]),
  );
  if (args.help === true || !argumentGiven(args.pageId) || !changes) return false;
  const page = await ctx.deps.prisma.page.findFirst({
    where: { id: String(args.pageId), spaceId: ctx.run.spaceId, userId: ctx.run.userId },
    select: { visibility: true },
  });
  return Boolean(page && page.visibility !== "private");
}

/** A bot's consequential tool call, recorded in its organization's audit log. */
export async function auditToolCall(
  ctx: RunContext,
  tool: string,
  outcome: "success" | "failure" | "denied",
  metadata: AuditEventInput["metadata"],
  recorded: Pick<AuditEventInput, "action" | "actor"> = {
    action: "tool.call",
    actor: { type: "bot", id: ctx.bot.id, label: ctx.bot.name },
  },
): Promise<void> {
  await recordAuditEvent({
    ...recorded,
    spaceId: ctx.run.spaceId,
    target: { type: "tool", id: tool, label: humanizeToolName(tool) },
    outcome,
    runId: ctx.runId,
    threadId: ctx.thread.id,
    metadata,
  });
}

function blockingRuleSuffix(resolved: ReturnType<typeof resolveActionApprovalForTools>): string {
  const labels = decisiveActionApprovalRules(resolved).map((rule) => {
    const value = rule.matchValue.trim().replace(/\s+/g, " ");
    return JSON.stringify(rule.matchKind === "site" ? value : humanizeToolName(value));
  });
  if (labels.length === 0) return "";
  return ` by the saved ${labels.length === 1 ? "rule" : "rules"} ${labels.join(", ")}`;
}

function createToolCall(
  ctx: RunContext,
  fields: Omit<ToolCall, "claimedEffect" | "persistEffectResult" | "finish" | "claimOrReturn">,
): ToolCall {
  const { deps } = ctx;
  const { name, args, applied } = fields;
  const call: ToolCall = {
    ...fields,
    claimedEffect: false,
    persistEffectResult: (result) =>
      applied
        ? completeEffect(
            deps,
            applied.effect.id,
            call.claimedEffect ? "executing" : "intended",
            result,
          )
        : Promise.resolve(true),
    finish: async (result) =>
      (await call.persistEffectResult(result)) ? result : uncertainEffectResult(name, args),
    claimOrReturn: async (from) => {
      if (await claimEffect(deps, ctx.runId, applied!.effect.id, from)) {
        call.claimedEffect = true;
        return undefined;
      }
      const current = await deps.prisma.externalEffect.findUnique({
        where: { id: applied!.effect.id },
      });
      if (current) {
        const retryGate = resolveDuplicateEffectGate(current, name);
        if (retryGate.action === "return") return retryGate.result;
        if (retryGate.action === "uncertain") {
          return settleToolUncertainty(ctx, call, applied!.effect.id, name);
        }
      }
      throw uncertainEffectError(name);
    },
  };
  return call;
}

async function settleToolUncertainty(
  ctx: RunContext,
  call: ToolCall,
  effectId: string,
  toolName: string,
) {
  if (call.name === "generate_image" || call.name === "generate_video") {
    const recovered = await callMediaTool(ctx, call, true);
    if (
      recovered !== undefined &&
      (await completeEffect(ctx.deps, effectId, "executing", recovered))
    )
      return recovered;
  }
  return settleUncertainEffect(ctx.deps.prisma, effectId, toolName, call.args);
}

/** Ask the owner through an approval card. Parallel calls share the first call's pause. */
function requestApproval(ctx: RunContext, call: ToolCall, card: ApprovalCard) {
  const { approval } = ctx.state;
  // Parallel calls can need approval at once. Only the first saves the turn and shows
  // its card; the others wait for that pause. Otherwise a later call's save could make
  // the turn resume a call other than the one the user approved.
  if (approval.request) return approval.request.then(() => pauseForApproval(ctx));
  approval.request = showApprovalCard(ctx, call, card);
  return approval.request;
}

async function showApprovalCard(ctx: RunContext, call: ToolCall, card: ApprovalCard) {
  const { deps, run, runId, bot, thread } = ctx;
  const { name, args, executionId, applied } = call;
  if (!(await renewRunLease(deps, runId, ctx.workerId, ctx.fence))) {
    // Another worker owns the run now; exit without leaving a local pause card.
    return pauseForApproval(ctx);
  }
  await ctx.computer.checkpoint.flush();
  await persistTurnCheckpoint(ctx, executionId);
  await ctx.settleRunningHelpers();
  const paused = await deps.events.pauseRunForInput({
    spaceId: run.spaceId,
    threadId: run.threadId,
    botId: run.botId,
    runId,
    attemptId: ctx.attempt.id,
    leaseOwner: ctx.workerId,
    leaseFence: ctx.fence,
    blocks: [
      buildApprovalAskBlock(
        applied!.effect.id,
        name,
        name === "update_bot" && "previousInstructions" in args ? { ...args, botId: bot.id } : args,
        ctx.secrets,
        card,
      ),
    ],
  });
  // pauseRunForInput returning false after a successful renew means the run row no
  // longer matches this worker. Exiting via pauseForApproval() would leave the run
  // stuck in "running" with no ask card — fail instead so the user can retry.
  if (!paused) {
    throw new Error("Could not pause this run for approval; try sending again.");
  }
  if (paused.continuationRunId) {
    await deps.jobs
      .enqueue(runContinueJob(paused.continuationRunId))
      .catch((error) => getLogger().error("steering continuation enqueue", error));
  }
  await notifyRun(deps, run, {
    kind: "help",
    title: `${displayName(bot.name, "Bot")} needs approval`,
    body: `Review before ${name}`,
    botId: bot.id,
    threadId: thread.id,
  });
  return pauseForApproval(ctx);
}

/** What a review judges: the full URL and the owner's own words for a new site. */
async function reviewSubject(ctx: RunContext, review: ToolReview) {
  const { bot } = ctx;
  const { name, args, connectorKind, fetchUrl } = review;
  const botDescription = redactSecrets(`${bot.name}\n${bot.description}`, ctx.secrets);
  // A new site is judged on the full URL and the owner's own words only: the task
  // prompt of a webhook or bot-started run carries text someone else wrote.
  return review.newSite && fetchUrl
    ? {
        toolName: name,
        connectorKind,
        args: { url: redactSecrets(fetchUrl, ctx.secrets) },
        userTask: redactSecrets(await ctx.trust.loadOwnerWords(), ctx.secrets),
        botDescription,
      }
    : {
        toolName: name,
        connectorKind,
        args: redactToolArgsForReview(args, ctx.secrets),
        userTask: redactSecrets(ctx.task.prompt, ctx.secrets),
        botDescription,
      };
}

/** One engine's verdict on a call. A reviewer that throws counts as "could not check". */
async function reviewWith(ctx: RunContext, review: ToolReview, engine: VerificationEngineId) {
  const newSite = review.newSite && review.fetchUrl !== undefined;
  return ctx.verification.reviewAction(engine, {
    ...(await reviewSubject(ctx, review)),
    matchingRules: review.matchingRules,
    ...(newSite ? { newSite: true } : {}),
  });
}

const actionCheck = (name: string, effectId: string) =>
  ({ checkpoint: "action", subject: name, effectId }) as const;

/**
 * Run the selected verification engine on a call and store its verdict on the effect, with
 * its comparison row in the same interactive transaction. The shadow engine is only logged.
 * Returns nothing when there is no engine or the run was cancelled.
 */
async function reviewToolCall(
  ctx: RunContext,
  review: ToolReview,
): Promise<{ reason: string | undefined; decision: "ask" | "allow" } | undefined> {
  const { deps, context } = ctx;
  const { primary: primaryEngine, shadow: shadowEngine } = review.engines;
  if (!primaryEngine) return;
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
async function backfillShadowReview(ctx: RunContext, review: ToolReview) {
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
