import type { AgentToolExecutionObserver } from "@rakazo/adapter-kit";
import { diagnoseRunFailure, RunExecutionError, toolResultTaintsRun } from "@rakazo/core";
import { getLogger } from "@rakazo/logging";
import { isTerminatingReplyResult, isToolPauseResult } from "./approval-effect.js";
import { IMAGE_RETURNING_COMPUTER_TOOLS, MODEL_CANNOT_SEE_MESSAGE } from "./model-vision.js";
import type { RunContext } from "./run-context.js";
import { noteComputerTaskStep } from "./run-progress.js";
import type { ToolHandler } from "./run-tool-gate.js";
import { auditToolCall, gateToolCall } from "./run-tool-gate.js";
import { prepareToolRequest, resolveToolRequest } from "./run-tool-request.js";
import { PAGE_BROWSER_TOOL_NAMES } from "./run-tool-selection.js";
import { computerTools, pageBrowserTool } from "./run-tools-computer.js";
import { feedbackTools } from "./run-tools-feedback.js";
import { fileTools } from "./run-tools-files.js";
import { fleetTools } from "./run-tools-fleet.js";
import { cloudAgentTool, connectorTool, integrationTools } from "./run-tools-integrations.js";
import { manorToolHandler } from "./run-tools-manor.js";
import { memoryTools } from "./run-tools-memory.js";
import { messagingTools } from "./run-tools-messaging.js";
import { pageTools } from "./run-tools-pages.js";
import { preferenceTools } from "./run-tools-preferences.js";
import { purchaseTools } from "./run-tools-purchases.js";
import { secretTools } from "./run-tools-secrets.js";
import { taskTools } from "./run-tools-tasks.js";
import {
  USER_COMPUTER_ACT_TOOL,
  USER_COMPUTER_OBSERVE_TOOL,
  USER_COMPUTER_SHELL_TOOL,
  userComputerAct,
  userComputerObserve,
  userComputerShell,
} from "./run-tools-user-computer.js";
import { strategicInitiativeToolAllowed } from "./strategic-initiative.js";
import { argumentGiven } from "./update-bot-patch.js";

const TOOL_HANDLERS = new Map<string, ToolHandler>([
  ...Object.entries(computerTools),
  ...Object.entries(fileTools),
  ...Object.entries(pageTools),
  ...Object.entries(memoryTools),
  ...Object.entries(integrationTools),
  ...Object.entries(taskTools),
  ...Object.entries(messagingTools),
  ...Object.entries(secretTools),
  ...Object.entries(fleetTools),
  [USER_COMPUTER_SHELL_TOOL, userComputerShell],
  [USER_COMPUTER_OBSERVE_TOOL, userComputerObserve],
  [USER_COMPUTER_ACT_TOOL, userComputerAct],
  ...Object.entries(purchaseTools),
  ...Object.entries(preferenceTools),
  ...Object.entries(feedbackTools),
  ...[...PAGE_BROWSER_TOOL_NAMES].map((name) => [name, pageBrowserTool] as const),
]);

function toolHandler(name: string): ToolHandler {
  return (
    TOOL_HANDLERS.get(name) ??
    manorToolHandler(name) ??
    (name.startsWith("cloud_agent_") ? cloudAgentTool : connectorTool)
  );
}

/** Run one tool call of this run's model: gate it, then hand it to its tool family. */
export async function applyTool(
  ctx: RunContext,
  name: string,
  args: Record<string, unknown>,
  executionId: string,
  _route?: unknown,
  observer?: AgentToolExecutionObserver,
) {
  const { deps, run, runId, bot, thread } = ctx;
  ctx.context.signal.throwIfAborted();
  const startedAt = Date.now();
  let status: "completed" | "failed" | "paused" = "failed";
  try {
    const result = await dispatchTool(ctx, name, args, executionId, observer);
    status = isToolPauseResult(result)
      ? "paused"
      : result && typeof result === "object" && "error" in result && result.error
        ? "failed"
        : "completed";
    // Manor: what the reply check compares the finished reply against.
    if (status !== "paused") ctx.verification.answerSources.add(name, result, ctx.secrets);
    return result;
  } catch (error) {
    // Manor: run diagnostics name the stage that failed.
    throw new RunExecutionError(
      error instanceof Error ? error.message : String(error),
      diagnoseRunFailure(error, "tool"),
    );
  } finally {
    // Diagnostics must not turn a successful external action into a retry.
    await deps.events
      .append({
        spaceId: run.spaceId,
        threadId: thread.id,
        botId: bot.id,
        runId,
        type: "agent.tool.finished",
        payload: {
          name,
          executionId,
          status,
          durationMs: Math.max(0, Date.now() - startedAt),
        },
      })
      .catch(() => getLogger().error("run tool diagnostics unavailable", { runId }));
    // Editing its own profile returns only what this run wrote; a child's profile is another bot's.
    const ownProfile = name === "update_bot" && !argumentGiven(args.bot_id);
    if (toolResultTaintsRun(name) && !ownProfile) ctx.state.tainted = true;
  }
}

async function dispatchTool(
  ctx: RunContext,
  name: string,
  args: Record<string, unknown>,
  executionId: string,
  observer: AgentToolExecutionObserver | undefined,
) {
  ctx.context.signal.throwIfAborted();
  if (!strategicInitiativeToolAllowed(name, ctx.run)) {
    return { error: "Daily check-ins can only ask or message the user." };
  }
  if (ctx.state.handedOff) {
    return {
      error: "This stage was handed off. End the turn without more tool calls.",
    };
  }
  if (ctx.tools.disabled.has(name)) {
    return { error: "This tool is disabled for this bot." };
  }
  if (
    ["schedule_create", "routine_prepare_webhook"].includes(name) &&
    ["routine", "webhook"].includes(ctx.run.trigger)
  ) {
    return { error: "Routine creation and webhook setup must be requested in chat." };
  }
  if (name === "routine_prepare_webhook" && !ctx.computer.toolsAvailable) {
    return {
      error: "The computer is unavailable while this conversation is pinned to plugins.",
    };
  }
  if (PAGE_BROWSER_TOOL_NAMES.has(name) && !ctx.computer.pageBrowserAllowed) {
    return { error: "Page browser is unavailable on this computer." };
  }
  if (IMAGE_RETURNING_COMPUTER_TOOLS.has(name) && !ctx.computer.acceptsImages) {
    return { error: MODEL_CANNOT_SEE_MESSAGE };
  }
  const request = await resolveToolRequest(ctx, name, args, executionId);
  if ("error" in request) return request;
  const refused = await prepareToolRequest(ctx, request);
  if (refused) return refused;
  noteComputerTaskStep(ctx.state.reply, request.name);
  const gate = await gateToolCall(ctx, request, observer);
  if ("result" in gate) return gate.result;
  if (!gate.call.applied) return toolHandler(gate.call.name)(ctx, gate.call);
  let outcome: "success" | "failure" = "failure";
  try {
    const result = await toolHandler(gate.call.name)(ctx, gate.call);
    if (!isToolError(result)) outcome = "success";
    return result;
  } finally {
    await auditToolCall(ctx, gate.call.name, outcome, {
      effectId: gate.call.applied.effect.id,
      autoApproved: gate.call.bypassApproval,
    });
  }
}

export function isToolError(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  if ("error" in result) return true;
  return isTerminatingReplyResult(result);
}
