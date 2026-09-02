import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decodes an RFC 4648 base32 string (case-insensitive, spaces/padding tolerated). */
export function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  if (clean.length === 0) throw new Error("TOTP secret is empty");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("TOTP secret is not valid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
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
  const digits = options.digits ?? 6;
  const step = options.step ?? 30;
  const now = options.now ?? Date.now();
  const counter = Math.floor(now / 1000 / step);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Seconds until the current TOTP code rolls over. */
export function totpSecondsRemaining(now = Date.now(), step = 30): number {
  return step - (Math.floor(now / 1000) % step);
}
