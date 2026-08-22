/**
 * Mentions are the whole of room coordination: a message naming `@Bot` wakes
 * that bot on this thread. When a person writes it that is delegation; when a
 * bot writes it in its own reply that is a handoff, and both take this path.
 *
 * Because bots can wake each other, the guards below are not optional. Two bots
 * that mention each other would otherwise trade messages forever, and every hop
 * is a model call somebody pays for.
 */

/** Bot mentions per human turn before a room stops and waits for a person. */
export const MAX_BOT_HOPS_PER_TURN = 10;

export interface MentionableBot {
  id: string;
  name: string;
}

export interface RoomTurnMessage {
  role: string;
  authorBotId?: string | null;
}

/**
 * Bot ids named in `text`, in the order they appear, without repeats.
 *
 * Names are matched against the room's participants rather than a pattern,
 * because bot names hold spaces — "@Chief Of Staff Agent" is one mention, not
 * three. Longer names are tried first so "@Research Agent" is never read as
 * "@Research".
 */
export function parseMentions(text: string, participants: readonly MentionableBot[]): string[] {
  if (!text.includes("@")) return [];
  const haystack = text.toLowerCase();
  const byLongestName = [...participants].sort((a, b) => b.name.length - a.name.length);
  const found: Array<{ index: number; id: string }> = [];
  const claimed: Array<[number, number]> = [];

  for (const bot of byLongestName) {
    const needle = `@${bot.name.toLowerCase()}`;
    if (!needle.trim() || needle === "@") continue;
    let from = 0;
    while (true) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      const end = at + needle.length;
      // A longer participant name already covering this span wins.
      const overlaps = claimed.some(([start, stop]) => at < stop && end > start);
      // Require a boundary after the name so "@Scout" does not match "@Scouting".
      const next = haystack[end];
      const boundary = next === undefined || !/[a-z0-9]/.test(next);
      if (!overlaps && boundary) {
        claimed.push([at, end]);
        found.push({ index: at, id: bot.id });
      }
      from = at + 1;
    }
  }

  found.sort((a, b) => a.index - b.index);
  return [...new Set(found.map((entry) => entry.id))];
}

/**
 * How many bot messages have followed the last human turn. This is the hop
 * counter: it lives in the transcript rather than a column, so nothing a bot
 * writes can reset it.
 */
export function botHopsSinceHumanTurn(messages: readonly RoomTurnMessage[]): number {
  let hops = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user") break;
    if (message.role === "bot" && message.authorBotId) hops += 1;
  }
  return hops;
}

export type MentionRefusal = "hop_limit" | "already_running" | "not_a_participant";

export interface MentionDecision {
  wake: string[];
  refused: Array<{ botId: string; reason: MentionRefusal }>;
}

/**
 * Decide which mentioned bots may actually be woken.
 *
 * A mention from a person is always allowed through the hop limit — asking your
 * own team to do something should never be refused because the bots have been
 * busy. Only bot-to-bot chains are capped.
 */
export function decideMentions(input: {
  mentioned: readonly string[];
  participants: readonly MentionableBot[];
  authoredByBot: boolean;
  hopsSinceHumanTurn: number;
  botsAlreadyRunning: readonly string[];
  maxHops?: number;
}): MentionDecision {
  const maxHops = input.maxHops ?? MAX_BOT_HOPS_PER_TURN;
  const participantIds = new Set(input.participants.map((bot) => bot.id));
  const running = new Set(input.botsAlreadyRunning);
  const wake: string[] = [];
  const refused: Array<{ botId: string; reason: MentionRefusal }> = [];

  for (const botId of input.mentioned) {
    if (!participantIds.has(botId)) {
      refused.push({ botId, reason: "not_a_participant" });
      continue;
    }
    if (running.has(botId)) {
      // Waking a bot that is mid-run would interrupt its own work.
      refused.push({ botId, reason: "already_running" });
      continue;
    }
    if (input.authoredByBot && input.hopsSinceHumanTurn + wake.length >= maxHops) {
      refused.push({ botId, reason: "hop_limit" });
      continue;
    }
    wake.push(botId);
  }

  return { wake, refused };
}

/** A line the room can show when a handoff was refused, so it is never silent. */
export function refusalNotice(reason: MentionRefusal, botName: string): string {
  switch (reason) {
    case "hop_limit":
      return `Paused before waking ${botName}: this room has passed ${MAX_BOT_HOPS_PER_TURN} handoffs since anyone last spoke. Say something to continue.`;
    case "already_running":
      return `${botName} is already working in this room.`;
    case "not_a_participant":
      return `${botName} is not in this room.`;
  }
}
