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
