import { currentDbContext, type PrismaClient, runAsTenant } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { loadBotCredentialSecret, serializeBotCredentialSecret } from "./bot-credentials.js";
import { EncryptedSecretStore } from "./secrets.js";
import {
  listWorkspaceCredentials,
  loadWorkspaceCredential,
  saveWorkspaceCredential,
} from "./workspace-credentials.js";

type SecretRow = { id: string; userId: string; kind: string; ciphertext: string };
type CredentialRow = {
  id: string;
  workspaceId: string;
  provider: string;
  label: string;
  secretId: string;
  createdByUserId: string;
  updatedAt: Date;
};

/**
 * Mirrors the `secrets_tenant` policy for a Secret with no Space: inside a tenant
 * context only the member who saved it can see it; a system context sees every row.
 */
function secretVisible(secret: SecretRow): boolean {
  const context = currentDbContext();
  return context?.kind !== "tenant" || secret.userId === context.userId;
}

/** The two tables the credential helpers touch, held in memory. */
function memoryPrisma() {
  const secrets = new Map<string, SecretRow>();
  const credentials = new Map<string, CredentialRow>();
  const withSecret = (row: CredentialRow) => {
    const secret = secrets.get(row.secretId);
    // A required relation hidden by row-level security fails the query, as Prisma does.
    if (!secret || !secretVisible(secret)) throw new Error("credential points at a missing secret");
    return { ...row, secret: { id: secret.id, ciphertext: secret.ciphertext } };
  };
  const client = {
    secret: {
      create: async ({ data }: { data: SecretRow }) => {
        secrets.set(data.id, data);
        return data;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const secret = secrets.get(where.id);
        if (!secret || !secretVisible(secret)) throw new Error("record to delete does not exist");
        secrets.delete(where.id);
      },
      findFirst: async ({ where }: { where: { id: string } }) => secrets.get(where.id) ?? null,
    },
    workspaceCredential: {
      findUnique: async ({
        where,
      }: {
        where: { workspaceId_provider: { workspaceId: string; provider: string } };
      }) => {
        const key = where.workspaceId_provider;
        const row = [...credentials.values()].find(
          (item) => item.workspaceId === key.workspaceId && item.provider === key.provider,
        );
        return row ? withSecret(row) : null;
      },
      findMany: async ({ where }: { where: { workspaceId: string } }) =>
        [...credentials.values()]
          .filter((row) => row.workspaceId === where.workspaceId)
          .sort((a, b) => a.provider.localeCompare(b.provider))
          .map(withSecret),
      create: async ({ data }: { data: Omit<CredentialRow, "id" | "updatedAt"> }) => {
        const row = { ...data, id: `credential-${credentials.size + 1}`, updatedAt: new Date() };
        credentials.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<CredentialRow> }) => {
        const row = { ...credentials.get(where.id)!, ...data, updatedAt: new Date() };
        credentials.set(row.id, row);
        return row;
      },
    },
    $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(client),
  };
  return { prisma: client as unknown as PrismaClient, secrets, credentials };
}

const scope = { workspaceId: "workspace-1", userId: "user-1" };

describe("workspace credentials through the async secret store", () => {
  it("round-trips a provider credential as plain strings", async () => {
    const { prisma, secrets } = memoryPrisma();
    const store = new EncryptedSecretStore("synthetic-test-key");

    const saved = await saveWorkspaceCredential(prisma, store, scope, {
      provider: "buildium",
      label: "Ledger",
      fields: { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
    });
    expect(saved).toMatchObject({
      provider: "buildium",
      label: "Ledger",
      fields: ["clientId", "clientSecret"],
    });

    const [row] = [...secrets.values()];
    expect(row?.kind).toBe("workspace-credential");
    expect(row?.ciphertext).not.toContain("synthetic-secret");

    const loaded = await loadWorkspaceCredential(prisma, store, scope.workspaceId, "buildium");
    expect(loaded).toEqual({ clientId: "synthetic-client", clientSecret: "synthetic-secret" });
    // A missed await would hand a Promise to the parser and yield no usable fields.
    expect(typeof loaded?.clientSecret).toBe("string");
    expect(await loadWorkspaceCredential(prisma, store, scope.workspaceId, "zoho")).toBeNull();
  });

  it("merges a later save into the stored fields and rotates the sealed secret", async () => {
    const { prisma, secrets } = memoryPrisma();
    const store = new EncryptedSecretStore("synthetic-test-key");
    await saveWorkspaceCredential(prisma, store, scope, {
      provider: "zoho",
      fields: { clientId: "first-client", refreshToken: "first-token", region: "com" },
    });
    const [firstSecretId] = [...secrets.keys()];

    const updated = await saveWorkspaceCredential(prisma, store, scope, {
      provider: "zoho",
      fields: { refreshToken: "second-token", region: "" },
    });

    expect(updated.fields).toEqual(["clientId", "refreshToken"]);
    expect(await loadWorkspaceCredential(prisma, store, scope.workspaceId, "zoho")).toEqual({
      clientId: "first-client",
      refreshToken: "second-token",
    });
    expect(secrets.size).toBe(1);
    expect(secrets.has(firstSecretId!)).toBe(false);
  });

  it("lists field names for every provider without exposing values", async () => {
    const { prisma } = memoryPrisma();
    const store = new EncryptedSecretStore("synthetic-test-key");
    await saveWorkspaceCredential(prisma, store, scope, {
      provider: "openrouter",
      fields: { apiKey: "synthetic-openrouter-key" },
    });
    await saveWorkspaceCredential(prisma, store, scope, {
      provider: "buildium",
      fields: { clientSecret: "synthetic-secret", clientId: "synthetic-client" },
    });

    const listed = await listWorkspaceCredentials(prisma, store, scope.workspaceId);

    expect(listed.map((item) => [item.provider, item.fields])).toEqual([
      ["buildium", ["clientId", "clientSecret"]],
      ["openrouter", ["apiKey"]],
    ]);
    expect(JSON.stringify(listed)).not.toContain("synthetic-secret");
  });

  it("lets another member of the organization load and rotate a saved credential", async () => {
    const { prisma, secrets } = memoryPrisma();
    const store = new EncryptedSecretStore("synthetic-test-key");
    const firstMember = { spaceId: "space-a", userId: "user-1" };
    const secondMember = { spaceId: "space-b", userId: "user-2" };
    await runAsTenant(firstMember, () =>
      saveWorkspaceCredential(prisma, store, scope, {
        provider: "zoho",
        fields: { clientId: "synthetic-client", refreshToken: "first-token" },
      }),
    );
    const [firstSecretId] = [...secrets.keys()];
    // The fake enforces the policy: a tenant query of another member's secret fails.
    await expect(
      runAsTenant(secondMember, () =>
        prisma.workspaceCredential.findUnique({
          where: { workspaceId_provider: { workspaceId: scope.workspaceId, provider: "zoho" } },
          include: { secret: true },
        }),
      ),
    ).rejects.toThrow();

    await runAsTenant(secondMember, async () => {
      expect(await loadWorkspaceCredential(prisma, store, scope.workspaceId, "zoho")).toEqual({
        clientId: "synthetic-client",
        refreshToken: "first-token",
      });
      await saveWorkspaceCredential(
        prisma,
        store,
        { workspaceId: scope.workspaceId, userId: secondMember.userId },
        { provider: "zoho", fields: { refreshToken: "second-token" } },
      );
      expect(
        (await listWorkspaceCredentials(prisma, store, scope.workspaceId)).map(
          (item) => item.provider,
        ),
      ).toEqual(["zoho"]);
    });
    expect(secrets.has(firstSecretId!)).toBe(false);
    expect(await loadWorkspaceCredential(prisma, store, scope.workspaceId, "zoho")).toEqual({
      clientId: "synthetic-client",
      refreshToken: "second-token",
    });
    // Another organization's workspace id finds nothing, whichever member asks.
    expect(
      await runAsTenant(firstMember, () =>
        loadWorkspaceCredential(prisma, store, "workspace-other-org", "zoho"),
      ),
    ).toBeNull();
  });

  it("fails loudly when the stored secret cannot be read with this key", async () => {
    const { prisma } = memoryPrisma();
    await saveWorkspaceCredential(prisma, new EncryptedSecretStore("synthetic-test-key"), scope, {
      provider: "buildium",
      fields: { clientSecret: "synthetic-secret" },
    });

    await expect(
      loadWorkspaceCredential(
        prisma,
        new EncryptedSecretStore("another-synthetic-key"),
        scope.workspaceId,
        "buildium",
      ),
    ).rejects.toThrow();
  });
});

describe("stored bot logins through the async secret store", () => {
  it("reads back the password and one-time-code seed", async () => {
    const { prisma, secrets } = memoryPrisma();
    const store = new EncryptedSecretStore("synthetic-test-key");
    const context = {
      operationId: "test",
      traceId: "test",
      spaceId: "space-1",
      userId: "user-1",
      signal: new AbortController().signal,
    };
    const sealed = await store.put(
      serializeBotCredentialSecret({ password: "synthetic-password" })!,
      context,
    );
    secrets.set(sealed.id, {
      id: sealed.id,
      userId: "user-1",
      kind: "bot-credential",
      ciphertext: sealed.ciphertext,
    });

    expect(
      await loadBotCredentialSecret(
        prisma,
        store,
        { spaceId: "space-1", userId: "user-1" },
        sealed.id,
      ),
    ).toEqual({ password: "synthetic-password" });
    expect(
      await loadBotCredentialSecret(prisma, store, { spaceId: "space-1", userId: "user-1" }, null),
    ).toEqual({});
  });
});
