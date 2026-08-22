import { describe, expect, it, vi } from "vitest";
import { channelChatAllowed, sendChannelMessage } from "./channels.js";

const bridge = {
  CHANNEL_OUTBOUND_URL: "https://bridge.test/send",
  CHANNEL_OUTBOUND_TOKEN: "bridge-token",
} satisfies NodeJS.ProcessEnv;

describe("channel allowlist", () => {
  it("allows anything when no allowlist is configured", () => {
    expect(channelChatAllowed("chat-1", {})).toBe(true);
  });

  it("only allows listed conversations", () => {
    const env = { CHANNEL_ALLOWED_CHATS: "chat-1, chat-2" };
    expect(channelChatAllowed("chat-1", env)).toBe(true);
    expect(channelChatAllowed("chat-2", env)).toBe(true);
    expect(channelChatAllowed("attacker-chat", env)).toBe(false);
  });
});

describe("sendChannelMessage", () => {
  it("posts to the bridge with the bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendChannelMessage(
      { provider: "imessage", chatId: "chat-1", text: "on it" },
      { env: bridge },
    );
    expect(result).toMatchObject({ delivered: true, provider: "imessage", chatId: "chat-1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(bridge.CHANNEL_OUTBOUND_URL);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer bridge-token");
    expect(JSON.parse(String(init.body))).toEqual({
      provider: "imessage",
      chatId: "chat-1",
      text: "on it",
    });
    vi.unstubAllGlobals();
  });

  it("refuses conversations outside the allowlist without calling the bridge", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendChannelMessage(
      { provider: "imessage", chatId: "attacker-chat", text: "here is the client list" },
      { env: { ...bridge, CHANNEL_ALLOWED_CHATS: "chat-1" } },
    );
    expect(result.delivered).toBe(false);
    expect(result.detail).toMatch(/not in this deployment's allowed conversations/);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports a missing bridge instead of throwing", async () => {
    const result = await sendChannelMessage(
      { provider: "imessage", chatId: "chat-1", text: "hi" },
      { env: {} },
    );
    expect(result).toMatchObject({ delivered: false });
    expect(result.detail).toMatch(/No channel bridge/);
  });

  it("surfaces a bridge failure", async () => {
    vi.stubGlobal("fetch", async () => new Response("chat not found", { status: 404 }));
    const result = await sendChannelMessage(
      { provider: "imessage", chatId: "chat-1", text: "hi" },
      { env: bridge },
    );
    expect(result.delivered).toBe(false);
    expect(result.detail).toMatch(/404/);
    vi.unstubAllGlobals();
  });

  it("requires provider, chat, and text", async () => {
    const result = await sendChannelMessage(
      { provider: "imessage", chatId: "chat-1", text: "   " },
      { env: bridge },
    );
    expect(result.delivered).toBe(false);
  });
});
