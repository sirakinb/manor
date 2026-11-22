import { createHmac } from "node:crypto";
import type { AuthenticatorKey } from "@rakazo/contracts";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Bytes(secret: string): Buffer {
  let bits = "";
  for (const char of secret) bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
}

/** When the code this key shows at `now` gives way to its next one. */
export function totpCodeEnd(key: AuthenticatorKey, now: number): number {
  return (Math.floor(now / 1000 / key.period) + 1) * key.period * 1000;
}

/** The RFC 6238 code an authenticator app shows for this key at `now`. */
export function totpCode(key: AuthenticatorKey, now: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / key.period)));
  const mac = createHmac(key.algorithm, base32Bytes(key.secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** key.digits;
  return String(code).padStart(key.digits, "0");
}

// Manor: the per-bot saved logins (`bot_credentials`, `use_credential`) store a 2FA seed as a
// bare base32 secret and read codes through the helpers below, on top of upstream's totpCode.

/** Decodes an RFC 4648 base32 string (case-insensitive, spaces/padding tolerated). */
export function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  if (clean.length === 0) throw new Error("TOTP secret is empty");
  for (const char of clean) {
    if (!BASE32.includes(char)) throw new Error("TOTP secret is not valid base32");
  }
  return base32Bytes(clean);
}

/**
 * Accepts either a raw base32 secret or a full otpauth:// URI (as shown by
 * authenticator apps' "enter key manually" flow) and returns the base32 secret.
 */
export function normalizeTotpSecret(input: string): string {
  const trimmed = input.trim();
  if (/^otpauth:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const secret = url.searchParams.get("secret");
    if (!secret) throw new Error("otpauth URI has no secret");
    return normalizeTotpSecret(secret);
  }
  const clean = trimmed.toUpperCase().replace(/[\s=-]/g, "");
  decodeBase32(clean); // validate
  return clean;
}

/** RFC 6238 TOTP, SHA-1, 6 digits, 30-second step (what nearly every site uses). */
export function generateTotp(
  secret: string,
  options: { now?: number; digits?: number; step?: number } = {},
): string {
  const clean = secret.toUpperCase().replace(/[\s=-]/g, "");
  decodeBase32(clean); // validate
  return totpCode(
    { secret: clean, algorithm: "sha1", digits: options.digits ?? 6, period: options.step ?? 30 },
    options.now ?? Date.now(),
  );
}

/** Seconds until the current TOTP code rolls over. */
export function totpSecondsRemaining(now = Date.now(), step = 30): number {
  return step - (Math.floor(now / 1000) % step);
}
