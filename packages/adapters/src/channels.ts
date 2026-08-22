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
// Twilio needs no bridge: when TWILIO_* is configured, provider "twilio" is
// delivered straight to Twilio's API.
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

/**
 * The bot allowed to use messaging channels. Channels are a deployment-level
 * connection to one conversation, so only the bot wired to them may send —
 * otherwise any bot in any workspace could message the owner's phone.
 */
export function channelBotId(env: NodeJS.ProcessEnv = process.env) {
  return (env.CHANNEL_BOT_ID ?? env.TWILIO_BOT_ID ?? "").trim();
}

export function botMayUseChannels(botId: string, env: NodeJS.ProcessEnv = process.env) {
  const allowed = channelBotId(env);
  return allowed.length > 0 && botId === allowed;
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

  if (provider === "twilio" || provider === "sms") {
    const twilio = await sendViaTwilio(chatId, text, env, options.signal);
    if (twilio) return { ...twilio, provider, chatId };
  }

  if (!url) {
    return {
      delivered: false,
      provider,
      chatId,
      detail: "No channel bridge is configured for this deployment.",
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

/**
 * Twilio delivery. Returns null when the deployment has no Twilio credentials,
 * so the caller can fall back to a generic bridge.
 */
async function sendViaTwilio(
  to: string,
  text: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<{ delivered: boolean; detail?: string } | null> {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid || !authToken || !from) return null;

  const body = new URLSearchParams({ To: to, From: from, Body: text.slice(0, 1_600) });
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: signal ?? AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { delivered: false, detail: `twilio ${response.status}: ${detail.slice(0, 200)}` };
    }
    return { delivered: true };
  } catch (error) {
    return {
      delivered: false,
      detail: error instanceof Error ? error.message : "twilio send failed",
    };
  }
}
