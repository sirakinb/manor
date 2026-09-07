import {
  type Actor,
  MessageBlock,
  type RunActivityRow,
  type RunDiagnostics,
  RunFailureDiagnosticSchema,
  RunSchema,
} from "@rakazo/contracts";
import {
  ACTIVE_RUN_STATUSES,
  botMessageContext,
  diagnoseRunFailure,
  runFailureSummary,
} from "@rakazo/core";
import { createRepos, IsolationError, type Prisma, type PrismaClient } from "@rakazo/db";

const runSelect = {
  id: true,
  botId: true,
  threadId: true,
  taskId: true,
  status: true,
  trigger: true,
  routineId: true,
  modelProvider: true,
  modelId: true,
  error: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} satisfies Prisma.RunSelect;

function diagnosticRun(row: Prisma.RunGetPayload<{ select: typeof runSelect }>) {
  return RunSchema.parse({
    ...row,
    error: row.error ? runFailureSummary(diagnoseRunFailure(row.error)) : null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

export async function listBotRunHistory(prisma: PrismaClient, actor: Actor, botId: string) {
  await createRepos(prisma).getBot(actor, botId);
  const rows = await prisma.run.findMany({
    where: { botId, spaceId: actor.spaceId, userId: actor.userId },
    select: runSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  return { runs: rows.map(diagnosticRun) };
}

const LOG_TYPES = [
  "run.started",
  "run.checkpointed",
  "run.waiting_input",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "computer.takeover.requested",
  "agent.tool.called",
  "agent.tool.finished",
  "group.handoff",
];
const LOG_PAGE_SIZE = 100;

export async function getRunDiagnostics(
  prisma: PrismaClient,
  actor: Actor,
  input: { runId: string; before?: number },
): Promise<RunDiagnostics> {
  const row = await prisma.run.findFirst({
    where: {
      id: input.runId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      bot: { userId: actor.userId, spaceId: actor.spaceId },
    },
    select: runSelect,
  });
  if (!row) throw new IsolationError("Run not found");
  const where = { runId: row.id, spaceId: actor.spaceId, threadId: row.threadId };
  const [events, attempts, failureEvent] = await Promise.all([
    prisma.event.findMany({
      where: {
        ...where,
        type: { in: LOG_TYPES },
        ...(input.before === undefined ? {} : { seq: { lt: input.before } }),
      },
      select: { id: true, seq: true, type: true, createdAt: true, payload: true },
      orderBy: { seq: "desc" },
      take: LOG_PAGE_SIZE + 1,
    }),
    prisma.attempt.findMany({
      where: { runId: row.id },
      select: { status: true, startedAt: true, finishedAt: true },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
    prisma.event.findFirst({
      where: { ...where, type: "run.failed" },
      select: { payload: true },
      orderBy: { seq: "desc" },
    }),
  ]);
  const failurePayload = failureEvent?.payload as Record<string, unknown> | undefined;
  const parsedFailure = RunFailureDiagnosticSchema.safeParse(failurePayload?.diagnostic);
  const failure =
    row.status === "failed"
      ? parsedFailure.success
        ? parsedFailure.data
        : diagnoseRunFailure(row.error)
      : null;
  const page = events.slice(0, LOG_PAGE_SIZE).reverse();
  return {
    run: { ...diagnosticRun(row), error: failure ? runFailureSummary(failure) : null },
    failure,
    attempts: attempts.reverse().map((attempt) => ({
      ...attempt,
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() ?? null,
    })),
    events: page.map((event) => {
      const payload = event.payload as Record<string, unknown> | null;
      const toolEvent = event.type === "agent.tool.called" || event.type === "agent.tool.finished";
      return {
        id: event.id,
        seq: event.seq,
        type: event.type,
        createdAt: event.createdAt.toISOString(),
        tool:
          toolEvent &&
          typeof payload?.name === "string" &&
          /^[a-zA-Z0-9_.:-]{1,120}$/.test(payload.name)
            ? payload.name
            : null,
        status:
          event.type === "agent.tool.finished" &&
          (payload?.status === "completed" ||
            payload?.status === "failed" ||
            payload?.status === "paused")
            ? payload.status
            : null,
        durationMs:
          event.type === "agent.tool.finished" &&
          typeof payload?.durationMs === "number" &&
          Number.isFinite(payload.durationMs) &&
          payload.durationMs >= 0
            ? payload.durationMs
            : null,
      };
    }),
    olderCursor: events.length > LOG_PAGE_SIZE ? page[0]!.seq : null,
  };
}

const RECENT_LIMIT = 20;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

function promptSnippet(prompt: string, max = 120): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

export function activityPromptSnippet(
  input: { trigger: string; prompt: string; sourceBlocks?: unknown },
  max = 120,
): string {
  if (input.trigger !== "bot_message") return promptSnippet(input.prompt, max);
  const parsed = MessageBlock.array().safeParse(input.sourceBlocks);
  const message = parsed.success ? botMessageContext(parsed.data) : undefined;
  if (!message) return "Message from another agent";
  const name = message.fromBotName.trim() || "Another agent";
  const label =
    message.intent === "result" || message.intent === "status" || message.intent === "fyi"
      ? `Update from ${name}`
      : `${name} asked`;
  return promptSnippet(message.text.trim() ? `${label}: ${message.text}` : label, max);
}

export function activityNotificationsEnabled(
  groupId: string | null,
  notifyOnFinish: boolean,
): boolean {
  return groupId !== null || notifyOnFinish;
}

export async function listSpaceRuns(
  prisma: PrismaClient,
  actor: Actor,
  filter: "active" | "recent",
): Promise<RunActivityRow[]> {
  const rows = await prisma.run.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      bot: { archivedAt: null },
      ...(filter === "active"
        ? { status: { in: [...ACTIVE_RUN_STATUSES] } }
        : { status: { in: [...TERMINAL_STATUSES] } }),
    },
    include: {
      bot: { select: { name: true, archivedAt: true, notifyOnFinish: true } },
      task: { select: { prompt: true } },
      sourceMessage: { select: { blocks: true } },
      thread: {
        select: {
          groupId: true,
          group: { select: { name: true } },
        },
      },
    },
    orderBy:
      filter === "active"
        ? [{ updatedAt: "desc" }, { id: "desc" }]
        : [{ completedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    take: filter === "recent" ? RECENT_LIMIT : undefined,
  });

  return rows.map((row) => ({
    runId: row.id,
    botId: row.botId,
    botName: row.bot.name,
    groupId: row.thread.groupId,
    groupName: row.thread.group?.name ?? null,
    threadId: row.threadId,
    status: row.status as RunActivityRow["status"],
    trigger: row.trigger as RunActivityRow["trigger"],
    notificationsEnabled: activityNotificationsEnabled(row.thread.groupId, row.bot.notifyOnFinish),
    promptSnippet: activityPromptSnippet({
      trigger: row.trigger,
      prompt: row.task.prompt,
      sourceBlocks: row.sourceMessage?.blocks,
    }),
    updatedAt: (filter === "recent" && row.completedAt
      ? row.completedAt
      : row.updatedAt
    ).toISOString(),
  }));
}
