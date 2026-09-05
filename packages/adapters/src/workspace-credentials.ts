import type { PrismaClient } from "@rakazo/db";
import type { EncryptedSecretStore } from "./secrets.js";

/**
 * Per-organization provider logins for the Workspace (Buildium, Zoho, ...).
 * Field values are a JSON object sealed in a Secret row; callers only ever
 * see field names unless they load the credential to use it server-side.
 */

export const WORKSPACE_CREDENTIAL_SECRET_KIND = "workspace-credential";

export type WorkspaceCredentialFields = Record<string, string>;

export type WorkspaceCredentialScope = {
  workspaceId: string;
  /** The user acting, recorded on the Secret row and as the creator. */
  userId: string;
};

export function parseWorkspaceCredentialFields(plaintext: string): WorkspaceCredentialFields {
  const parsed = JSON.parse(plaintext) as unknown;
  if (!parsed || typeof parsed !== "object") return {};
  const fields: WorkspaceCredentialFields = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value) fields[key] = value;
  }
  return fields;
}

/** Merge a patch into stored fields: empty strings clear, everything else is kept verbatim. */
export function mergeWorkspaceCredentialFields(
  current: WorkspaceCredentialFields,
  patch: Record<string, string>,
): WorkspaceCredentialFields {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === "") delete next[key];
    else next[key] = value;
  }
  return next;
}

export type WorkspaceCredentialSummary = {
  provider: string;
  label: string;
  fields: string[];
  updatedAt: Date;
};

/** Field names only; values stay sealed. */
export async function listWorkspaceCredentials(
  prisma: PrismaClient,
  secrets: EncryptedSecretStore,
  workspaceId: string,
): Promise<WorkspaceCredentialSummary[]> {
  const rows = await prisma.workspaceCredential.findMany({
    where: { workspaceId },
    include: { secret: { select: { id: true, ciphertext: true } } },
    orderBy: { provider: "asc" },
  });
  return rows.map((row) => ({
    provider: row.provider,
    label: row.label,
    fields: Object.keys(
      parseWorkspaceCredentialFields(secrets.load(row.secret.ciphertext, row.secret.id)),
    ).sort(),
    updatedAt: row.updatedAt,
  }));
}

/** The decrypted fields for one provider, or null when nothing is stored. */
export async function loadWorkspaceCredential(
  prisma: PrismaClient,
  secrets: EncryptedSecretStore,
  workspaceId: string,
  provider: string,
): Promise<WorkspaceCredentialFields | null> {
  const row = await prisma.workspaceCredential.findUnique({
    where: { workspaceId_provider: { workspaceId, provider } },
    include: { secret: { select: { id: true, ciphertext: true } } },
  });
  if (!row) return null;
  return parseWorkspaceCredentialFields(secrets.load(row.secret.ciphertext, row.secret.id));
}

/**
 * Create or merge a provider credential. Each save seals a fresh Secret row
 * and drops the previous one, so a rotated value never lingers in ciphertext.
 */
export async function saveWorkspaceCredential(
  prisma: PrismaClient,
  secrets: EncryptedSecretStore,
  scope: WorkspaceCredentialScope,
  input: { provider: string; label?: string; fields: Record<string, string> },
): Promise<WorkspaceCredentialSummary> {
  const existing = await prisma.workspaceCredential.findUnique({
    where: { workspaceId_provider: { workspaceId: scope.workspaceId, provider: input.provider } },
    include: { secret: { select: { id: true, ciphertext: true } } },
  });
  const current = existing
    ? parseWorkspaceCredentialFields(secrets.load(existing.secret.ciphertext, existing.secret.id))
    : {};
  const merged = mergeWorkspaceCredentialFields(current, input.fields);
  const sealed = await secrets.put(JSON.stringify(merged), {
    operationId: "workspace.credentials.set",
    traceId: "workspace.credentials.set",
    spaceId: scope.workspaceId,
    userId: scope.userId,
    signal: new AbortController().signal,
  });
  const row = await prisma.$transaction(async (tx) => {
    await tx.secret.create({
      data: {
        id: sealed.id,
        userId: scope.userId,
        kind: WORKSPACE_CREDENTIAL_SECRET_KIND,
        ciphertext: sealed.ciphertext,
      },
    });
    const saved = existing
      ? await tx.workspaceCredential.update({
          where: { id: existing.id },
          data: {
            secretId: sealed.id,
            ...(input.label === undefined ? {} : { label: input.label }),
          },
        })
      : await tx.workspaceCredential.create({
          data: {
            workspaceId: scope.workspaceId,
            provider: input.provider,
            label: input.label ?? "",
            secretId: sealed.id,
            createdByUserId: scope.userId,
          },
        });
    if (existing) await tx.secret.delete({ where: { id: existing.secret.id } });
    return saved;
  });
  return {
    provider: row.provider,
    label: row.label,
    fields: Object.keys(merged).sort(),
    updatedAt: row.updatedAt,
  };
}

export async function deleteWorkspaceCredential(
  prisma: PrismaClient,
  workspaceId: string,
  provider: string,
): Promise<void> {
  const row = await prisma.workspaceCredential.findUnique({
    where: { workspaceId_provider: { workspaceId, provider } },
    select: { secretId: true },
  });
  if (!row) return;
  // The credential row cascades from its secret.
  await prisma.secret.delete({ where: { id: row.secretId } });
}
