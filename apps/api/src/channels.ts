// Inbound messaging channels.
//
// A bridge (iMessage via BlueBubbles, Slack, an SMS gateway) posts a message
// here and it becomes a normal user turn for one bot: same thread, same run
// machinery, same tools. The bridge authenticates with a shared secret; the
// bot's owner and workspace are always read from the bot row, never from the
// request body, so a compromised bridge cannot address another tenant.
//
// Configure with:
//   CHANNEL_WEBHOOK_SECRET  shared secret the bridge presents (required)
//
// Reply delivery is the agent's `send_channel_message` tool; see
// packages/adapters/src/channels.ts.
import { timingSafeEqual } from "node:crypto";
import { type JobPublisher, runContinueJob } from "@rakazo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import type { Context, Hono } from "hono";
import { buildUserMessageBlocks } from "./artifacts.js";
import { twilioConfig, twilioSenderAllowed, twilioSignatureValid } from "./twilio.js";

export interface ChannelDeps {
  prisma: PrismaClient;
  events: ThreadEvents;
  jobs: JobPublisher;
}

const MAX_TEXT_LENGTH = 8_000;

/**
 * Twilio signs the public URL it posted to, but the request reaches the API
 * through a tunnel and the web proxy, so req.url is the internal address by
 * then. Rebuild the public URL for verification.
 */
function twilioWebhookUrl(fallback: string, env: NodeJS.ProcessEnv = process.env) {
  const configured = env.TWILIO_WEBHOOK_URL?.trim();
  if (configured) return configured;
  const base = (env.API_URL ?? env.WEB_ORIGIN ?? "").trim().replace(/\/$/, "");
  return base ? `${base}/api/channels/twilio/inbound` : fallback;
}

/** Empty TwiML: accept the message without sending an automatic reply. */
function twiml() {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}

export function channelWebhookSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.CHANNEL_WEBHOOK_SECRET?.trim() ?? "";
}

function authorized(c: Context, secret: string) {
  const header = c.req.header("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!secret) return false;
  const expected = Buffer.from(secret);
  const candidate = Buffer.from(supplied);
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

/**
 * Describes where a message came from so the agent can reply to the same
 * conversation. Kept in the prompt rather than a column so channels need no
 * schema change; the reply tool takes the chat id back as an argument.
 */
function originPreamble(provider: string, chatId: string, from: string | undefined) {
  const who = from ? ` from ${from}` : "";
  return (
    `[Message received over ${provider}${who}. ` +
    `To reply in this conversation, call send_channel_message with ` +
    `provider "${provider}" and chat_id "${chatId}".]`
  );
}

export function mountChannelRoutes(app: Hono, deps: ChannelDeps) {
  app.post("/api/channels/:provider/inbound", async (c) => {
    const provider = c.req.param("provider").slice(0, 40);
    let botId = "";
    let text = "";
    let chatId = "";
    let from: string | undefined;
    let messageId = "";

    if (provider === "twilio") {
      // Twilio posts a form and proves itself with a request signature.
      const config = twilioConfig();
      if (!config) return c.json({ error: "Twilio is not configured" }, 503);
      const form = Object.fromEntries(
        [...(await c.req.formData().catch(() => new FormData())).entries()].map(([k, v]) => [
          k,
          String(v),
        ]),
      ) as Record<string, string>;
      const signature = c.req.header("x-twilio-signature") ?? "";
      if (!twilioSignatureValid(twilioWebhookUrl(c.req.url), form, signature, config.authToken)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      from = (form.From ?? "").slice(0, 200);
      if (!twilioSenderAllowed(from, config)) {
        // Answer 200 so Twilio does not retry a message we will never accept.
        return c.body(twiml(), 200, { "content-type": "text/xml" });
      }
      botId = config.botId;
      text = (form.Body ?? "").slice(0, MAX_TEXT_LENGTH).trim();
      chatId = from;
      messageId = (form.MessageSid ?? "").slice(0, 200);
      if (!text) return c.body(twiml(), 200, { "content-type": "text/xml" });
    } else {
      const secret = channelWebhookSecret();
      if (!secret) return c.json({ error: "Channels are not configured" }, 503);
      if (!authorized(c, secret)) return c.json({ error: "Unauthorized" }, 401);

      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      botId = typeof body.botId === "string" ? body.botId : "";
      text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT_LENGTH).trim() : "";
      chatId = typeof body.chatId === "string" ? body.chatId.slice(0, 200) : "";
      from = typeof body.from === "string" ? body.from.slice(0, 200) : undefined;
      messageId = typeof body.messageId === "string" ? body.messageId.slice(0, 200) : "";

      if (!botId || !text || !chatId) {
        return c.json({ error: "botId, text, and chatId are required" }, 400);
      }
    }

    // Trusted context: the bot row decides the workspace and user.
    const bot = await deps.prisma.bot.findUnique({
      where: { id: botId },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        archivedAt: true,
        thread: { select: { id: true } },
      },
    });
    if (!bot || bot.archivedAt || !bot.thread) return c.json({ error: "Unknown bot" }, 404);

    // The channel's own message id doubles as the idempotency key, so a bridge
    // retrying delivery cannot start the work twice.
    const nonce = messageId ? `${provider}:${messageId}` : undefined;
    if (nonce) {
      const existing = await deps.prisma.run.findFirst({
        where: { workspaceId: bot.workspaceId, clientNonce: nonce },
        select: { id: true, taskId: true },
      });
      if (existing) {
        return provider === "twilio"
          ? c.body(twiml(), 200, { "content-type": "text/xml" })
          : c.json({ ok: true, runId: existing.id, duplicate: true });
      }
    }

    const prompt = `${originPreamble(provider, chatId, from)}\n\n${text}`;
    const sent = await deps.events.sendUserMessage({
      workspaceId: bot.workspaceId,
      threadId: bot.thread.id,
      botId: bot.id,
      userId: bot.userId,
      blocks: buildUserMessageBlocks(text, []),
      prompt,
      trigger: "user",
      clientNonce: nonce,
      linkMessageToRun: true,
    });
    const runId = sent.runId;
    if (!runId) return c.json({ error: "Could not start a run" }, 500);

    await deps.prisma.run.updateMany({
      where: { botId: bot.id, status: "queued", id: { not: runId } },
      data: { status: "cancelled", completedAt: new Date() },
    });
    await deps.jobs.enqueue(runContinueJob(runId));
    return provider === "twilio"
      ? c.body(twiml(), 200, { "content-type": "text/xml" })
      : c.json({ ok: true, runId });
  });
}
