// Twilio SMS as a Manor channel.
//
// Twilio posts form-encoded webhooks rather than JSON and authenticates with a
// request signature instead of a bearer token, so it gets its own translation
// in front of the shared channel handling.
//
//   TWILIO_ACCOUNT_SID    account the number belongs to
//   TWILIO_AUTH_TOKEN     used to verify inbound signatures and to send
//   TWILIO_FROM_NUMBER    the Manor number, e.g. +18778388671
//   TWILIO_BOT_ID         bot that receives texts sent to that number
//   TWILIO_ALLOWED_FROM   comma-separated numbers allowed to command the bot
//
// TWILIO_ALLOWED_FROM matters: a phone number is public, so without it anyone
// who texts the number is driving an agent that holds your logins.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  botId: string;
  allowedFrom: string[];
}

export function twilioConfig(env: NodeJS.ProcessEnv = process.env): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const fromNumber = env.TWILIO_FROM_NUMBER?.trim() ?? "";
  const botId = env.TWILIO_BOT_ID?.trim() ?? "";
  if (!accountSid || !authToken || !fromNumber || !botId) return null;
  return {
    accountSid,
    authToken,
    fromNumber,
    botId,
    allowedFrom: (env.TWILIO_ALLOWED_FROM ?? "")
      .split(",")
      .map((entry) => digits(entry))
      .filter(Boolean),
  };
}

/** Compare numbers by digits so +1 (914) 316-6585 matches +19143166585. */
function digits(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function twilioSenderAllowed(from: string, config: TwilioConfig) {
  if (config.allowedFrom.length === 0) return false;
  const candidate = digits(from);
  return config.allowedFrom.some((entry) => numbersMatch(entry, candidate));
}

/**
 * Numbers may arrive with or without a country code, so compare on the shorter
 * of the two and require enough digits that the match is meaningful.
 */
function numbersMatch(a: string, b: string) {
  if (!a || !b) return false;
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  return shorter.length >= 7 && longer.endsWith(shorter);
}

/**
 * Twilio signs each request with the full URL plus the sorted POST body.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function twilioSignatureValid(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string,
) {
  if (!signature) return false;
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac("sha1", authToken)
    .update(Buffer.from(payload, "utf8"))
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sendTwilioSms(
  input: { to: string; text: string },
  config: TwilioConfig,
  options: { signal?: AbortSignal } = {},
): Promise<{ delivered: boolean; detail?: string }> {
  const body = new URLSearchParams({
    To: input.to,
    From: config.fromNumber,
    Body: input.text.slice(0, 1_600),
  });
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: options.signal,
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { delivered: false, detail: `twilio ${response.status}: ${detail.slice(0, 200)}` };
    }
    return { delivered: true };
  } catch (error) {
    return { delivered: false, detail: error instanceof Error ? error.message : "send failed" };
  }
}
