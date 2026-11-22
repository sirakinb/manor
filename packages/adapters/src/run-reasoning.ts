import type { AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { createStreamingRedactor, redactSecrets } from "@rakazo/core";
import type { RunContext } from "./runs/assembly/run-context.js";
import { flushPendingTools, flushProgress } from "./runs/lifecycle/run-progress.js";

/**
 * Manor: reasoning streams beside the reply. Deltas batch into thread.thinking events, and
 * the finished thought becomes a durable "thinking" block placed before the text that followed it.
 */
export interface ReasoningState {
  current: string;
  pending: string;
  startedAt: number;
  lastFlushAt: number;
  streamed: boolean;
  redactor: ReturnType<typeof createStreamingRedactor>;
}

export function createReasoningState(secrets: string[]): ReasoningState {
  return {
    current: "",
    pending: "",
    startedAt: 0,
    lastFlushAt: 0,
    streamed: false,
    redactor: createStreamingRedactor(secrets),
  };
}

async function flushReasoning(ctx: RunContext) {
  const { deps, run, runId, bot, thread } = ctx;
  const reasoning = ctx.state.reasoning;
  if (ctx.scripted || !reasoning.pending) return;
  await deps.events.append({
    spaceId: run.spaceId,
    threadId: thread.id,
    botId: bot.id,
    type: "thread.thinking",
    runId,
    payload: reasoning.streamed
      ? { delta: reasoning.pending, streaming: true }
      : { text: reasoning.pending, streaming: true },
  });
  reasoning.streamed = true;
  reasoning.pending = "";
  reasoning.lastFlushAt = Date.now();
}

/** Close the current thought: publish what is left and keep it as a durable block. */
export async function finishReasoning(ctx: RunContext) {
  const { deps, run, runId, bot, thread } = ctx;
  const reasoning = ctx.state.reasoning;
  const { reply } = ctx.state;
  if (!reasoning.current) return;
  reasoning.pending += reasoning.redactor.finish();
  reasoning.redactor = createStreamingRedactor(ctx.secrets);
  await flushReasoning(ctx);
  const durationMs = Math.max(0, Date.now() - reasoning.startedAt);
  reply.messageSegments = [
    ...reply.messageSegments,
    { kind: "thinking", text: redactSecrets(reasoning.current, ctx.secrets), durationMs },
  ];
  if (!ctx.scripted && reasoning.streamed) {
    await deps.events.append({
      spaceId: run.spaceId,
      threadId: thread.id,
      botId: bot.id,
      type: "thread.thinking",
      runId,
      payload: { done: true, durationMs },
    });
  }
  reasoning.current = "";
  reasoning.pending = "";
  reasoning.streamed = false;
  reasoning.startedAt = 0;
}

export async function streamReasoning(
  ctx: RunContext,
  event: Extract<AgentRuntimeEvent, { type: "reasoning" }>,
) {
  const reasoning = ctx.state.reasoning;
  if (event.done) {
    await finishReasoning(ctx);
    return;
  }
  if (!event.text) return;
  if (!reasoning.current) {
    // The thought goes after everything streamed so far, on both sides.
    flushPendingTools(ctx.state.reply);
    await flushProgress(ctx);
    reasoning.startedAt = Date.now();
  }
  reasoning.current += event.text;
  reasoning.pending += reasoning.redactor.push(event.text);
  if (!ctx.scripted && reasoning.pending && Date.now() - reasoning.lastFlushAt >= 250) {
    await flushReasoning(ctx);
  }
}
