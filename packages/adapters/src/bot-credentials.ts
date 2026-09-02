import type { PrismaClient } from "@rakazo/db";
import type { EncryptedSecretStore } from "./secrets.js";
import { generateTotp, normalizeTotpSecret, totpSecondsRemaining } from "./totp.js";

export const BOT_CREDENTIAL_SECRET_KIND = "bot-credential";

/** Encrypted payload behind a BotCredential row. Never leaves the server side. */
export type BotCredentialSecret = { password?: string; totp?: string };

export type BotCredentialRow = {
  id: string;
  label: string;
  site: string;
  username: string;
  notes: string;
  hasPassword: boolean;
  hasTotp: boolean;
  secretId: string | null;
};

export type BotCredentialField = "username" | "password" | "totp";
export const BOT_CREDENTIAL_FIELDS: BotCredentialField[] = ["username", "password", "totp"];

export function serializeBotCredentialSecret(secret: BotCredentialSecret): string | null {
  const payload: BotCredentialSecret = {};
  if (secret.password) payload.password = secret.password;
  if (secret.totp) payload.totp = normalizeTotpSecret(secret.totp);
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
}

export function parseBotCredentialSecret(plaintext: string): BotCredentialSecret {
  const parsed = JSON.parse(plaintext) as unknown;
  if (!parsed || typeof parsed !== "object") return {};
  const record = parsed as Record<string, unknown>;
  return {
    ...(typeof record.password === "string" ? { password: record.password } : {}),
    ...(typeof record.totp === "string" ? { totp: record.totp } : {}),
  };
}

export async function loadBotCredentialSecret(
  prisma: PrismaClient,
  secrets: EncryptedSecretStore,
  scope: { spaceId: string; userId: string },
  secretId: string | null,
): Promise<BotCredentialSecret> {
  if (!secretId) return {};
  const row = await prisma.secret.findFirst({
    where: { id: secretId, spaceId: scope.spaceId, userId: scope.userId },
    select: { id: true, ciphertext: true },
  });
  if (!row) return {};
  return parseBotCredentialSecret(secrets.load(row.ciphertext, row.id));
}

/** Case-insensitive match on id or label; a unique substring match on label also works. */
export function findBotCredential<T extends { id: string; label: string }>(
  rows: T[],
  query: string,
): T | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  const exact = rows.find((row) => row.id === query || row.label.toLowerCase() === needle);
  if (exact) return exact;
  const partial = rows.filter((row) => row.label.toLowerCase().includes(needle));
  return partial.length === 1 ? partial[0] : undefined;
}

/** Plain-text summary for the system prompt. Secrets are described, never included. */
export function formatBotCredentialsPrompt(rows: BotCredentialRow[]): string | undefined {
  if (rows.length === 0) return undefined;
  const lines = rows.map((row) => {
    const parts = [`"${row.label}"`];
    if (row.site) parts.push(`site ${row.site}`);
    if (row.username) parts.push(`username ${row.username}`);
    const stored = [row.hasPassword ? "password" : null, row.hasTotp ? "2FA code" : null].filter(
      Boolean,
    );
    if (stored.length > 0) parts.push(`stored: ${stored.join(", ")}`);
    if (row.notes) parts.push(`notes: ${row.notes}`);
    return `- ${parts.join(" — ")}`;
  });
  return [
    "Stored sign-in credentials for this bot. Sign in yourself with them: click the field on the computer, then call use_credential with the credential label and field to type it (username, password, or the current 2FA code). The secret values are typed for you and never shown; do not ask for them and do not request takeover for these logins. Security-question answers and other hints are in the notes.",
    ...lines,
  ].join("\n");
}

/** Resolves the text to type for one field, or an error the model can act on. */
export function resolveBotCredentialValue(
  row: BotCredentialRow,
  secret: BotCredentialSecret,
  field: BotCredentialField,
  now = Date.now(),
): { ok: true; text: string; note?: string } | { ok: false; error: string } {
  if (field === "username") {
    return row.username
      ? { ok: true, text: row.username }
      : { ok: false, error: `"${row.label}" has no username stored.` };
  }
  if (field === "password") {
    return secret.password
      ? { ok: true, text: secret.password }
      : { ok: false, error: `"${row.label}" has no password stored; ask the user to add one.` };
  }
  if (!secret.totp) {
    return {
      ok: false,
      error: `"${row.label}" has no 2FA seed stored. If the site emailed or texted a code, read it from a connected plugin; otherwise request takeover for the code.`,
    };
  }
  const remaining = totpSecondsRemaining(now);
  // Avoid typing a code that expires mid-submit.
  const at = remaining < 5 ? now + remaining * 1000 : now;
  return {
    ok: true,
    text: generateTotp(secret.totp, { now: at }),
    note: `code valid for ${remaining < 5 ? 30 : remaining}s; submit promptly`,
  };
}
