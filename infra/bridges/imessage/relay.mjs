#!/usr/bin/env node
// iMessage <-> Manor relay.
//
// Runs on the Mac next to BlueBubbles Server and translates between the two:
//
//   BlueBubbles webhook  -> POST /bluebubbles  -> Manor inbound channel
//   Manor send tool      -> POST /send         -> BlueBubbles send API
//
// No dependencies; run it with plain node (22+).
//
//   MANOR_URL              https://manor.example.com
//   MANOR_BOT_ID           bot that receives these messages
//   CHANNEL_WEBHOOK_SECRET must match Manor's value
//   CHANNEL_OUTBOUND_TOKEN must match Manor's value (auth for /send)
//   BLUEBUBBLES_URL        http://127.0.0.1:1234
//   BLUEBUBBLES_PASSWORD   BlueBubbles server password
//   ALLOWED_SENDERS        comma-separated handles allowed to command the bot
//   PORT                   default 8787
//
// ALLOWED_SENDERS is not optional in spirit. Anyone who can text this Mac can
// otherwise drive an agent that holds your logins, so the relay refuses every
// sender until you list the ones you trust.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const config = {
  manorUrl: (process.env.MANOR_URL ?? "").replace(/\/$/, ""),
  botId: process.env.MANOR_BOT_ID ?? "",
  inboundSecret: process.env.CHANNEL_WEBHOOK_SECRET ?? "",
  outboundToken: process.env.CHANNEL_OUTBOUND_TOKEN ?? "",
  blueBubblesUrl: (process.env.BLUEBUBBLES_URL ?? "http://127.0.0.1:1234").replace(/\/$/, ""),
  blueBubblesPassword: process.env.BLUEBUBBLES_PASSWORD ?? "",
  allowedSenders: (process.env.ALLOWED_SENDERS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
  port: Number(process.env.PORT ?? 8787),
};

for (const [key, value] of Object.entries(config)) {
  if (value === "" || (Array.isArray(value) && value.length === 0)) {
    console.error(`Missing configuration: ${key}`);
    if (key !== "allowedSenders") process.exit(1);
    console.error("  -> no sender is allowed to command the bot until you set ALLOWED_SENDERS");
  }
}

const log = (...args) => console.log(new Date().toISOString(), ...args);

function normalizeHandle(value) {
  // Compare phone numbers by digits so +1 555 123 4567 matches +15551234567.
  const trimmed = String(value ?? "")
    .trim()
    .toLowerCase();
  return trimmed.includes("@") ? trimmed : trimmed.replace(/[^\d]/g, "");
}

function senderAllowed(handle) {
  const candidate = normalizeHandle(handle);
  if (!candidate) return false;
  return config.allowedSenders.some((entry) => {
    const allowed = normalizeHandle(entry);
    return allowed === candidate || (allowed.length >= 7 && candidate.endsWith(allowed));
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("payload too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bearer(req) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

// --- BlueBubbles -> Manor ----------------------------------------------------

async function handleBlueBubbles(req, res) {
  const payload = await readJson(req);
  const type = payload.type ?? payload.event;
  const data = payload.data ?? {};

  if (type !== "new-message") return json(res, 200, { ignored: `event ${type}` });
  if (data.isFromMe) return json(res, 200, { ignored: "own message" });

  const text = String(data.text ?? "").trim();
  const chatId = data.chats?.[0]?.guid ?? data.chatGuid ?? "";
  const from = data.handle?.address ?? data.handleId ?? "";
  const messageId = data.guid ?? "";

  if (!text || !chatId) return json(res, 200, { ignored: "no text or chat" });
  if (!senderAllowed(from)) {
    log(`refused message from ${from || "unknown sender"}`);
    return json(res, 200, { ignored: "sender not allowed" });
  }

  const response = await fetch(`${config.manorUrl}/api/channels/imessage/inbound`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.inboundSecret}`,
    },
    body: JSON.stringify({ botId: config.botId, text, chatId, from, messageId }),
  });
  const body = await response.text();
  log(`inbound from ${from} -> manor ${response.status}`);
  return json(res, response.ok ? 200 : 502, { manor: response.status, body: body.slice(0, 200) });
}

// --- Manor -> BlueBubbles ----------------------------------------------------

async function handleSend(req, res) {
  if (config.outboundToken && bearer(req) !== config.outboundToken) {
    return json(res, 401, { error: "unauthorized" });
  }
  const { chatId, text } = await readJson(req);
  if (!chatId || !text) return json(res, 400, { error: "chatId and text are required" });

  const url = new URL(`${config.blueBubblesUrl}/api/v1/message/text`);
  url.searchParams.set("password", config.blueBubblesPassword);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chatGuid: chatId,
      tempGuid: randomUUID(),
      message: String(text),
      method: "apple-script",
    }),
  });
  const body = await response.text();
  log(`outbound -> ${chatId} (bluebubbles ${response.status})`);
  return json(res, response.ok ? 200 : 502, {
    bluebubbles: response.status,
    body: body.slice(0, 200),
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (req.url?.startsWith("/bluebubbles")) return await handleBlueBubbles(req, res);
    if (req.url?.startsWith("/send")) return await handleSend(req, res);
    return json(res, 404, { error: "not found" });
  } catch (error) {
    log("error", error);
    return json(res, 500, { error: error instanceof Error ? error.message : "relay failed" });
  }
}).listen(config.port, "127.0.0.1", () => {
  log(`iMessage relay on http://127.0.0.1:${config.port}`);
  log(`  bot ${config.botId} · ${config.allowedSenders.length} allowed sender(s)`);
});
