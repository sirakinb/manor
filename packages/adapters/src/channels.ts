// Outbound messaging channels.
//
// Delivers an agent's reply back to the bridge that produced the inbound
// message (iMessage via BlueBubbles, Slack, an SMS gateway).
//
// Configure with:
//   CHANNEL_OUTBOUND_URL     bridge endpoint that accepts {provider, chatId, text}
//   CHANNEL_OUTBOUND_TOKEN   bearer token presented to the bridge
//   CHANNEL_ALLOWED_CHATS    optional comma-separated allowlist of chat ids
//
// The allowlist matters more than it looks. An agent that reads untrusted
// content can be talked into replying somewhere new, which is the shape data
// exfiltration takes on a messaging channel. When it is set, the agent can only
// ever reach conversations the deployment already trusts, no matter what a page
// or an inbound message tells it to do.

const OUTBOUND_TIMEOUT_MS = 15_000;
const MAX_TEXT_LENGTH = 4_000;

export interface ChannelSendRequest {
  provider: string;
  chatId: string;
  text: string;
}

export interface ChannelSendResult {
  delivered: boolean;
  provider: string;
  chatId: string;
  detail?: string;
}

export function channelOutboundConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.CHANNEL_OUTBOUND_URL?.trim());
}

export function allowedChannelChats(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CHANNEL_ALLOWED_CHATS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function channelChatAllowed(chatId: string, env: NodeJS.ProcessEnv = process.env) {
  const allowed = allowedChannelChats(env);
  return allowed.length === 0 || allowed.includes(chatId);
}

export async function sendChannelMessage(
  request: ChannelSendRequest,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<ChannelSendResult> {
  const env = options.env ?? process.env;
  const url = env.CHANNEL_OUTBOUND_URL?.trim();
  const provider = request.provider.trim();
  const chatId = request.chatId.trim();
  const text = request.text.slice(0, MAX_TEXT_LENGTH);

  if (!url) {
    return {
      delivered: false,
      provider,
      chatId,
      detail: "No channel bridge is configured for this deployment.",
    };
  }
  if (!provider || !chatId || !text.trim()) {
    return {
      delivered: false,
      provider,
      chatId,
      detail: "provider, chat_id, and text are required",
    };
  }
  if (!channelChatAllowed(chatId, env)) {
    return {
      delivered: false,
      provider,
      chatId,
      detail: `Refusing to message ${chatId}: it is not in this deployment's allowed conversations.`,
    };
  }

  const token = env.CHANNEL_OUTBOUND_TOKEN?.trim();
  const signals = [options.signal, AbortSignal.timeout(OUTBOUND_TIMEOUT_MS)].filter(
    Boolean,
  ) as AbortSignal[];

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ provider, chatId, text }),
      signal: AbortSignal.any(signals),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        delivered: false,
        provider,
        chatId,
        detail: `bridge responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }
    return { delivered: true, provider, chatId };
  } catch (error) {
    return {
      delivered: false,
      provider,
      chatId,
      detail: error instanceof Error ? error.message : "channel delivery failed",
    };
  }
}
