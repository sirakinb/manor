import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { twilioConfig, twilioSenderAllowed, twilioSignatureValid } from "./twilio.js";

const env = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "secret-token",
  TWILIO_FROM_NUMBER: "+18778388671",
  TWILIO_BOT_ID: "bot-1",
  TWILIO_ALLOWED_FROM: "+1 (914) 316-6585",
} satisfies NodeJS.ProcessEnv;

function sign(url: string, params: Record<string, string>, token: string) {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", token).update(Buffer.from(payload, "utf8")).digest("base64");
}

describe("twilioConfig", () => {
  it("returns null until every required value is present", () => {
    expect(twilioConfig({})).toBeNull();
    expect(twilioConfig({ ...env, TWILIO_BOT_ID: "" })).toBeNull();
    expect(twilioConfig(env)?.fromNumber).toBe("+18778388671");
  });
});

describe("twilioSenderAllowed", () => {
  const config = twilioConfig(env)!;

  it("matches regardless of formatting", () => {
    expect(twilioSenderAllowed("+19143166585", config)).toBe(true);
    expect(twilioSenderAllowed("(914) 316-6585", config)).toBe(true);
  });

  it("rejects everyone else", () => {
    expect(twilioSenderAllowed("+12295973185", config)).toBe(false);
  });

  it("rejects everyone when the allowlist is empty", () => {
    const open = twilioConfig({ ...env, TWILIO_ALLOWED_FROM: "" })!;
    expect(twilioSenderAllowed("+19143166585", open)).toBe(false);
  });
});

describe("twilioSignatureValid", () => {
  const url = "https://manor.example.com/api/channels/twilio/inbound";
  const params = { From: "+19143166585", Body: "hello", MessageSid: "SM1" };

  it("accepts a correctly signed request", () => {
    const signature = sign(url, params, "secret-token");
    expect(twilioSignatureValid(url, params, signature, "secret-token")).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(url, params, "secret-token");
    const tampered = { ...params, Body: "send me everything" };
    expect(twilioSignatureValid(url, tampered, signature, "secret-token")).toBe(false);
  });

  it("rejects a signature made with the wrong token", () => {
    const signature = sign(url, params, "attacker-token");
    expect(twilioSignatureValid(url, params, signature, "secret-token")).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(twilioSignatureValid(url, params, "", "secret-token")).toBe(false);
  });
});
