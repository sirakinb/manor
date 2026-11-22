import type { Actor, RunActivityRow, RunDiagnostics } from "@rakazo/contracts";
import { MessageBlock, RunFailureDiagnosticSchema, RunSchema } from "@rakazo/contracts";
import {
  ACTIVE_RUN_STATUSES,
  BACKGROUND_HELPER_TRIGGER,
  BACKGROUND_RUN_TRIGGERS,
  botMessageContext,
  diagnoseRunFailure,
  displayName,
  HELPER_RESULT_TRIGGER,
  runFailureSummary,
  truncatePlainText,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { createRepos, IsolationError, Prisma } from "@rakazo/db";

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
// Background ticket work belongs on the board, not in the activity list. A background helper and
// the turn passing on its result show in the chat, on the helper's card.
const ACTIVITY_HIDDEN_TRIGGERS = [
  ...BACKGROUND_RUN_TRIGGERS,
  BACKGROUND_HELPER_TRIGGER,
  HELPER_RESULT_TRIGGER,
] as const;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

function promptSnippet(prompt: string, max = 120): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${truncatePlainText(oneLine, max - 1)}…`;
}

export function activityPreview(
  input: { trigger: string; prompt: string; sourceBlocks?: unknown },
  max = 120,
): Pick<RunActivityRow, "promptSnippet" | "agentMessage"> {
  if (input.trigger !== "bot_message")
    return { promptSnippet: promptSnippet(input.prompt, max), agentMessage: null };
  const parsed = MessageBlock.array().safeParse(input.sourceBlocks);
  const message = parsed.success ? botMessageContext(parsed.data) : undefined;
  if (!message) {
    return {
      promptSnippet: "Message from another agent",
      agentMessage: { kind: "unknown" },
    };
  }
  const name = displayName(message.fromBotName, "Another agent");
  const kind =
    message.intent === "result" || message.intent === "status" || message.intent === "fyi"
      ? "update"
      : "request";
  const label = kind === "update" ? `Update from ${name}` : `${name} asked`;
  return {
    promptSnippet: promptSnippet(message.text.trim() ? `${label}: ${message.text}` : label, max),
    agentMessage: {
      fromBotName: displayName(message.fromBotName, ""),
      kind,
      text: promptSnippet(message.text, max),
    },
  };
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
    where:
      filter === "active"
        ? {
            spaceId: actor.spaceId,
            bot: { archivedAt: null },
            trigger: { notIn: [...ACTIVITY_HIDDEN_TRIGGERS] },
            status: { in: [...ACTIVE_RUN_STATUSES] },
          }
        : { spaceId: actor.spaceId, id: { in: await latestFinishedRunPerChat(prisma, actor) } },
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
  });

  return rows.map((row) => ({
    runId: row.id,
    botId: row.botId,
    botName: row.bot.name,
    groupId: row.thread.groupId,
    groupName: row.thread.group ? row.thread.group.name : null,
    threadId: row.threadId,
    status: row.status as RunActivityRow["status"],
    trigger: row.trigger as RunActivityRow["trigger"],
    notificationsEnabled: activityNotificationsEnabled(row.thread.groupId, row.bot.notifyOnFinish),
    ...activityPreview({
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

/** Recent lists chats keyed like `activitySections`, so one busy chat must not push the others out of the limit. */
async function latestFinishedRunPerChat(prisma: PrismaClient, actor: Actor): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM (
      SELECT DISTINCT ON (COALESCE('group:' || t."groupId", 'bot:' || r."botId")) r.id, r."completedAt", r."updatedAt"
      FROM runs r
      JOIN threads t ON t.id = r."threadId"
      JOIN bots b ON b.id = r."botId"
      WHERE r."spaceId" = ${actor.spaceId}
        AND b."archivedAt" IS NULL
        AND r.trigger NOT IN (${Prisma.join([...ACTIVITY_HIDDEN_TRIGGERS])})
        AND r.status IN (${Prisma.join([...TERMINAL_STATUSES])})
      ORDER BY COALESCE('group:' || t."groupId", 'bot:' || r."botId"), r."completedAt" DESC, r."updatedAt" DESC, r.id DESC
    ) latest
    ORDER BY "completedAt" DESC, "updatedAt" DESC, id DESC
    LIMIT ${RECENT_LIMIT}`;
  return rows.map((row) => row.id);
}
