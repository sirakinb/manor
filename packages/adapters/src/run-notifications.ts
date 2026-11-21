import type { NotificationMessage } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import {
  isBackgroundRunTrigger,
  plainTextFromMarkdown,
  redactSecrets,
  truncatedPlainText,
  truncatePlainText,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { countUnreadInboxChats, spaceNotificationRecipients } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import { notificationIdentity } from "./notification-identity.js";

export async function runNotificationsEnabled(
  prisma: PrismaClient,
  run: { spaceId: string; userId: string; botId: string; threadId: string },
): Promise<boolean> {
  return (await runNotice(prisma, run)).enabled;
}

async function runNotice(
  prisma: PrismaClient,
  run: { spaceId: string; userId: string; botId: string; threadId: string },
  routineId?: string | null,
): Promise<{
  enabled: boolean;
  groupId: string | null;
  bot?: { id: string; name: string; color: string; avatarSet: string };
}> {
  // A routine carries its own notify setting, which decides on its failures.
  const routine = routineId
    ? await prisma.routine.findUnique({ where: { id: routineId }, select: { notify: true } })
    : null;
  const source = await prisma.run.findFirst({
    where: {
      botId: run.botId,
      threadId: run.threadId,
      spaceId: run.spaceId,
      userId: run.userId,
    },
    select: {
      bot: { select: { id: true, name: true, color: true, avatarSet: true, notifyOnFinish: true } },
      thread: { select: { groupId: true } },
    },
  });
  if (!source) return { enabled: false, groupId: null };
  return {
    enabled: routine ? routine.notify : Boolean(source.thread.groupId || source.bot.notifyOnFinish),
    groupId: source.thread.groupId,
    bot: source.bot,
  };
}

export async function notifyRun(
  deps: ExecutorDeps,
  run: {
    spaceId: string;
    userId: string;
    botId: string;
    threadId: string;
    trigger: string;
    routineId?: string | null;
  },
  message: NotificationMessage,
  options: { retryOnFailure?: boolean } = {},
) {
  if (
    !deps.notifications ||
    (isBackgroundRunTrigger(run.trigger) && message.kind !== "help" && message.kind !== "takeover")
  )
    return;
  const routineId = message.kind === "failure" ? run.routineId : null;
  const notice = await runNotice(deps.prisma, run, routineId).catch((error) => {
    if (options.retryOnFailure) throw error;
    getLogger().error("notification preference lookup", error);
    return null;
  });
  if (!notice?.enabled) return;
  const bot = notice.bot;
  const sender = bot && (await notificationIdentity(bot));
  const notification = {
    ...message,
    ...(sender ? { sender } : {}),
    ...(notice.groupId ? { groupId: notice.groupId } : {}),
  };
  // Manor: every member of a shared space is notified.
  const recipients = await spaceNotificationRecipients(deps.prisma, run).catch((error) => {
    if (options.retryOnFailure) throw error;
    getLogger().error("notification recipient lookup", error);
    return [] as string[];
  });
  // The icon shows what the inbox shows: unread chats across the user's Spaces. Without a
  // count the push leaves the badge as it is. The count is read in the run owner's context,
  // so only the owner's push carries one; other members keep their badge as it is.
  const ownerBadge = recipients.includes(run.userId)
    ? await countUnreadInboxChats(deps.prisma, {
        userId: run.userId,
        spaceId: run.spaceId,
      }).catch((error) => {
        getLogger().error("unread chat count", error);
        return undefined;
      })
    : undefined;
  const sent = await Promise.allSettled(
    recipients.map((userId) =>
      deps.notifications!.send(
        userId === run.userId && ownerBadge !== undefined
          ? { ...notification, badge: ownerBadge }
          : notification,
        {
          operationId: "notify",
          traceId: run.botId,
          spaceId: run.spaceId,
          userId,
          botId: run.botId,
          signal: new AbortController().signal,
        },
      ),
    ),
  );
  const failures = sent.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  for (const error of failures) getLogger().error("run notification", error);
  // A retry resends to every recipient, so retry only when nobody received the notice.
  if (options.retryOnFailure && failures.length > 0 && failures.length === sent.length) {
    throw failures[0];
  }
}

export function runSendsFinishNotification(trigger: string): boolean {
  return trigger !== "created" && !isBackgroundRunTrigger(trigger);
}

/** User-facing text for completion notifications; empty when only tool/step activity remains. */
export function completionNotificationBody(assembled: string, blocks: MessageBlock[]): string {
  if (assembled) return assembled;
  return blocks
    .filter((block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("");
}

const COMPLETION_NOTIFICATION_MAX_CHARS = 180;

/** Push body: Markdown stripped, then truncated so a cut cannot land inside a marker. */
export function completionNotificationPreview(text: string): string {
  return truncatedPlainText(text, COMPLETION_NOTIFICATION_MAX_CHARS);
}

/** A secret card can ask for a code or a login, so the title stays generic and the label short. */
export function secretAskNotification(botName: string, label: string, runSecrets: string[]) {
  // Strip and redact before shortening so no protected value is left half-shown.
  const text = plainTextFromMarkdown(redactSecrets(label, runSecrets), { maxSource: Infinity });
  const body = truncatePlainText(
    redactSecrets(text, runSecrets),
    COMPLETION_NOTIFICATION_MAX_CHARS,
  );
  return { title: `${botName} needs an answer`, body };
}

export function completionMarksUnread(
  trigger: string,
  text: string,
  userFacingPeerReply = false,
): boolean {
  if (trigger === "bot_message") return userFacingPeerReply;
  if (isBackgroundRunTrigger(trigger)) return false;
  return (trigger !== "routine" && trigger !== "reaction") || Boolean(text);
}

export function subagentMarksUnread(
  trigger: string,
  status: "running" | "completed" | "failed",
  userFacingPeerReply = false,
) {
  if (isBackgroundRunTrigger(trigger)) return false;
  return (
    status === "failed" ||
    (trigger === "bot_message" && userFacingPeerReply) ||
    (trigger !== "routine" && trigger !== "bot_message")
  );
}
