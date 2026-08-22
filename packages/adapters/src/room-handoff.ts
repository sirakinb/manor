/**
 * A bot's reply in a room can hand work to another participant by naming it.
 * This is the same rule a person's message follows — mention someone and they
 * wake — which is why a handoff needs no machinery of its own.
 *
 * It runs after the reply is already stored and the run is finalized, so a
 * failure here must never fail the run: the work is done either way, and the
 * worst case is a handoff that did not happen.
 */

import type { JobPublisher } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import { botHopsSinceHumanTurn, decideMentions, parseMentions } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

/** How far back to look when counting handoffs since the last human turn. */
const HOP_LOOKBACK = 60;

const ACTIVE = ["queued", "leased", "running", "waiting_input"] as const;

export interface RoomHandoffDeps {
  prisma: PrismaClient;
  jobs: JobPublisher;
}

export interface RoomHandoffInput {
  threadId: string;
  workspaceId: string;
  userId: string;
  /** The bot whose reply this is. Its own mentions of itself are ignored. */
  authorBotId: string;
  text: string;
}

export interface RoomHandoffResult {
  woke: string[];
  refused: Array<{ botId: string; reason: string }>;
}

export async function handOffRoomMentions(
  deps: RoomHandoffDeps,
  input: RoomHandoffInput,
): Promise<RoomHandoffResult> {
  const none: RoomHandoffResult = { woke: [], refused: [] };
  if (!input.text.includes("@")) return none;

  const thread = await deps.prisma.thread.findUnique({
    where: { id: input.threadId },
    select: { id: true, kind: true },
  });
  if (thread?.kind !== "room") return none;

  const participants = await deps.prisma.bot.findMany({
    where: { roomMemberships: { some: { threadId: thread.id } }, archivedAt: null },
    select: { id: true, name: true },
  });

  const mentioned = parseMentions(input.text, participants).filter(
    // A bot naming itself is talking about itself, not handing over.
    (botId) => botId !== input.authorBotId,
  );
  if (mentioned.length === 0) return none;

  const [recent, running] = await Promise.all([
    deps.prisma.message.findMany({
      where: { threadId: thread.id },
      orderBy: { seq: "desc" },
      take: HOP_LOOKBACK,
      select: { role: true, authorBotId: true },
    }),
    deps.prisma.run.findMany({
      where: { threadId: thread.id, status: { in: [...ACTIVE] } },
      select: { botId: true },
    }),
  ]);

  const decision = decideMentions({
    mentioned,
    participants,
    authoredByBot: true,
    hopsSinceHumanTurn: botHopsSinceHumanTurn([...recent].reverse()),
    botsAlreadyRunning: running.map((run) => run.botId),
  });
  if (decision.wake.length === 0) {
    return { woke: [], refused: decision.refused };
  }

  const woke: string[] = [];
  for (const botId of decision.wake) {
    const task = await deps.prisma.task.create({
      data: {
        workspaceId: input.workspaceId,
        botId,
        threadId: thread.id,
        userId: input.userId,
        prompt: input.text,
        status: "queued",
      },
    });
    const run = await deps.prisma.run.create({
      data: {
        workspaceId: input.workspaceId,
        botId,
        threadId: thread.id,
        taskId: task.id,
        userId: input.userId,
        status: "queued",
        trigger: "user",
      },
    });
    await deps.jobs.enqueue(runContinueJob(run.id));
    woke.push(botId);
  }
  return { woke, refused: decision.refused };
}

/**
 * Wake the next bot a person named but that has not run yet this turn.
 *
 * A message naming several bots reads as an order — "@Scout find them, then
 * @Quill write it up" — far more often than as a poll, so the room runs them
 * one at a time and each sees what came before. Waking them together made the
 * second answer before it had anything to answer with.
 *
 * Nothing is stored: who is still owed a turn is read back from the transcript,
 * the same way the hop counter is, so a crash or a retry cannot desync it.
 */
export async function wakeNextMentioned(
  deps: RoomHandoffDeps,
  input: { threadId: string; workspaceId: string; userId: string },
): Promise<string | null> {
  const thread = await deps.prisma.thread.findUnique({
    where: { id: input.threadId },
    select: { id: true, kind: true },
  });
  if (thread?.kind !== "room") return null;

  // One at a time: if anyone is still working, they will call this when done.
  const active = await deps.prisma.run.count({
    where: { threadId: thread.id, status: { in: [...ACTIVE] } },
  });
  if (active > 0) return null;

  const turn = await deps.prisma.message.findFirst({
    where: { threadId: thread.id, role: "user" },
    orderBy: { seq: "desc" },
    select: { createdAt: true, blocks: true },
  });
  if (!turn) return null;

  const text = messageText(turn.blocks);
  if (!text.includes("@")) return null;

  const participants = await deps.prisma.bot.findMany({
    where: { roomMemberships: { some: { threadId: thread.id } }, archivedAt: null },
    select: { id: true, name: true },
  });

  // A bot that already has a run this turn has had its say, even if that run
  // failed — otherwise a bot that cannot start would be woken forever.
  const started = await deps.prisma.run.findMany({
    where: { threadId: thread.id, createdAt: { gte: turn.createdAt } },
    select: { botId: true },
  });
  const done = new Set(started.map((run) => run.botId));
  const next = parseMentions(text, participants).find((botId) => !done.has(botId));
  if (!next) return null;

  const task = await deps.prisma.task.create({
    data: {
      workspaceId: input.workspaceId,
      botId: next,
      threadId: thread.id,
      userId: input.userId,
      prompt: text,
      status: "queued",
    },
  });
  const run = await deps.prisma.run.create({
    data: {
      workspaceId: input.workspaceId,
      botId: next,
      threadId: thread.id,
      taskId: task.id,
      userId: input.userId,
      status: "queued",
      trigger: "user",
    },
  });
  await deps.jobs.enqueue(runContinueJob(run.id));
  return next;
}

/** Text of a stored message, which keeps its content as a block array. */
function messageText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) =>
      block && typeof block === "object" && "text" in block && typeof block.text === "string"
        ? block.text
        : "",
    )
    .filter(Boolean)
    .join("\n\n");
}
