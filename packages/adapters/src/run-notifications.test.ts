import type { NotificationMessage } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { notifyRun } from "./run-notifications.js";

vi.mock("./notification-identity.js", () => ({ notificationIdentity: async () => undefined }));
const recipients = vi.hoisted(() => ({ members: null as string[] | null }));
vi.mock("@rakazo/db", () => ({
  countUnreadInboxChats: async () => 2,
  // Manor: a shared space notifies every member; otherwise only the run's user.
  spaceNotificationRecipients: async (_prisma: unknown, scope: { userId: string }) =>
    recipients.members ?? [scope.userId],
}));

const run = {
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  threadId: "thread-1",
  trigger: "user",
};

const message: NotificationMessage = {
  kind: "completion",
  title: "Scout finished",
  body: "The report is ready.",
  botId: "bot-1",
  threadId: "thread-1",
  runId: "run-1",
};

function deps({
  notifyOnFinish = true,
  groupId = null as string | null,
  publish = vi.fn(async () => undefined),
} = {}) {
  const send = vi.fn(async () => undefined);
  const value = {
    prisma: {
      routine: { findUnique: async () => null },
      run: {
        findFirst: async () => ({
          bot: { id: "bot-1", name: "Scout", color: "#000000", avatarSet: "", notifyOnFinish },
          thread: { groupId },
        }),
      },
    },
    events: { publishChatAlert: publish },
    notifications: { send },
  } as unknown as ExecutorDeps;
  return { value, publish, send };
}

describe("notifyRun chat alerts", () => {
  it("publishes the alert for open apps alongside the push", async () => {
    const { value, publish, send } = deps();
    await notifyRun(value, run, message);
    expect(publish).toHaveBeenCalledWith("user-1", {
      kind: "completion",
      title: "Scout finished",
      body: "The report is ready.",
      spaceId: "space-1",
      botId: "bot-1",
      threadId: "thread-1",
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("names the group a bot's alert came from", async () => {
    const { value, publish } = deps({ notifyOnFinish: false, groupId: "group-1" });
    await notifyRun(value, run, message);
    expect(publish).toHaveBeenCalledWith("user-1", expect.objectContaining({ groupId: "group-1" }));
  });

  it("publishes nothing for a muted chat", async () => {
    const { value, publish, send } = deps({ notifyOnFinish: false });
    await notifyRun(value, run, message);
    expect(publish).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("never holds up or blocks the push", async () => {
    const { value, send } = deps({ publish: vi.fn(() => new Promise<undefined>(() => {})) });
    await notifyRun(value, run, message);
    expect(send).toHaveBeenCalledOnce();
    const failing = deps({ publish: vi.fn(async () => Promise.reject(new Error("down"))) });
    await notifyRun(failing.value, run, message);
    expect(failing.send).toHaveBeenCalledOnce();
  });

  it("still pushes where open apps have no alert publisher", async () => {
    const { value, send } = deps();
    delete (value.events as { publishChatAlert?: unknown }).publishChatAlert;
    await notifyRun(value, run, message);
    expect(send).toHaveBeenCalledOnce();
  });

  it("publishes even where phones have no push provider", async () => {
    const { value, publish } = deps();
    delete (value as { notifications?: unknown }).notifications;
    await notifyRun(value, run, message);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("alerts and pushes to every member of a shared space", async () => {
    recipients.members = ["member-a", "member-b"];
    try {
      const { value, publish, send } = deps();
      await notifyRun(value, { ...run, userId: "space-account" }, message);
      expect(publish.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
        "member-a",
        "member-b",
      ]);
      expect(send.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
        expect.objectContaining({ userId: "member-a" }),
        expect.objectContaining({ userId: "member-b" }),
      ]);
      expect(publish).not.toHaveBeenCalledWith("space-account", expect.anything());
    } finally {
      recipients.members = null;
    }
  });
});
