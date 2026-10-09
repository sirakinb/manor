import { createHash } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { PrismaClient } from "@rakazo/db";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  isAllowedRedirectUri,
  mountMcpOAuthProvider,
  requestedScopes,
} from "./mcp-oauth-provider.js";

const ORIGIN = "https://manor.example.test";
const REDIRECT = "https://client.example.test/callback";
const VERIFIER = "v".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

type Row = Record<string, unknown> & { id: string };

function table() {
  const rows: Row[] = [];
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) =>
      value && typeof value === "object" && "lt" in value
        ? (row[key] as Date) < (value as { lt: Date }).lt
        : row[key] === value,
    );
  return {
    rows,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `row_${rows.length + 1}`, revokedAt: null, ...data } as Row;
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((row) => matches(row, where)) ?? null,
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i]!, where)) rows.splice(i, 1);
      return { count: before - rows.length };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const hits = rows.filter((row) => matches(row, where));
      for (const row of hits) Object.assign(row, data);
      return { count: hits.length };
    },
  };
}

function setup(signedIn = true) {
  const prisma = {
    oAuthClient: table(),
    oAuthAuthorizationCode: table(),
    integrationCredential: table(),
  };
  const app = new Hono();
  mountMcpOAuthProvider(app, {
    prisma: prisma as unknown as PrismaClient,
    publicOrigin: () => ORIGIN,
    resolveActor: async () =>
      signedIn
        ? {
            userId: "user_1",
            spaceId: "space_1",
            organizationId: "org_1",
            email: "owner@example.test",
            isDeploymentOwner: false,
          }
        : null,
  });
  app.all("/mcp/crm", (c) => c.json({ error: { message: "Invalid integration credential" } }, 401));
  return { app, prisma };
}

const authorizeParams = (clientId: string) => ({
  response_type: "code",
  client_id: clientId,
  redirect_uri: REDIRECT,
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
  state: "state-1",
  scope: "crm:read crm:write",
});

async function register(app: Hono, body: Record<string, unknown> = {}) {
  const response = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], ...body }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

async function approve(app: Hono, clientId: string, scopes = ["crm:read"]) {
  const response = await app.request("/v1/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...authorizeParams(clientId), scopes }),
  });
  return { status: response.status, body: (await response.json()) as { redirect_to: string } };
}

function token(app: Hono, form: Record<string, string>) {
  return app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

describe("MCP OAuth provider", () => {
  it("points unauthenticated MCP requests at the resource metadata", async () => {
    const { app } = setup();
    const response = await app.request("/mcp/crm", { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp/crm"`,
    );
    const resource = await app.request("/.well-known/oauth-protected-resource/mcp/crm");
    expect(await resource.json()).toMatchObject({
      resource: `${ORIGIN}/mcp/crm`,
      authorization_servers: [ORIGIN],
    });
    const server = await app.request("/.well-known/oauth-authorization-server");
    expect(await server.json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
    });
    expect((await app.request("/.well-known/oauth-protected-resource/v1/x")).status).toBe(404);
  });

  it("issues a scoped credential for an approved code and rotates it on refresh", async () => {
    const { app, prisma } = setup();
    const client = await register(app);
    expect(client.status).toBe(201);
    expect(client.body.client_secret).toBeUndefined();

    const details = await app.request(
      `/v1/oauth/authorize?${new URLSearchParams(authorizeParams(client.body.client_id!))}`,
    );
    expect(await details.json()).toEqual({
      client_name: "Claude",
      redirect_host: "client.example.test",
      scopes: ["crm:read", "crm:write"],
    });

    const approved = await approve(app, client.body.client_id!);
    const redirect = new URL(approved.body.redirect_to);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
    expect(redirect.searchParams.get("state")).toBe("state-1");
    expect(redirect.searchParams.get("iss")).toBe(ORIGIN);
    const code = redirect.searchParams.get("code")!;

    const exchange = {
      grant_type: "authorization_code",
      client_id: client.body.client_id!,
      code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
    };
    const issued = await token(app, exchange);
    expect(issued.status).toBe(200);
    const tokens = (await issued.json()) as Record<string, string>;
    expect(tokens).toMatchObject({ token_type: "Bearer", scope: "crm:read" });
    expect(tokens.access_token).toMatch(/^manor_/);
    expect(prisma.integrationCredential.rows).toHaveLength(1);
    expect(prisma.integrationCredential.rows[0]).toMatchObject({
      spaceId: "space_1",
      createdByUserId: "user_1",
      name: "Claude",
      scopes: ["crm:read"],
      tokenHash: createHash("sha256").update(tokens.access_token!).digest("hex"),
    });

    // Codes are single-use.
    expect((await token(app, exchange)).status).toBe(400);

    const refreshed = await token(app, {
      grant_type: "refresh_token",
      client_id: client.body.client_id!,
      refresh_token: tokens.refresh_token!,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as Record<string, string>;
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(prisma.integrationCredential.rows).toHaveLength(1);
    expect(prisma.integrationCredential.rows[0]!.tokenHash).toBe(
      createHash("sha256").update(next.access_token!).digest("hex"),
    );

    // The rotated-out refresh token is dead, and a revoked grant cannot refresh.
    const replay = await token(app, {
      grant_type: "refresh_token",
      client_id: client.body.client_id!,
      refresh_token: tokens.refresh_token!,
    });
    expect(replay.status).toBe(400);
    prisma.integrationCredential.rows[0]!.revokedAt = new Date();
    const revoked = await token(app, {
      grant_type: "refresh_token",
      client_id: client.body.client_id!,
      refresh_token: next.refresh_token!,
    });
    expect(revoked.status).toBe(400);
  });

  it("rejects a wrong PKCE verifier, redirect, or client secret", async () => {
    const { app } = setup();
    const confidential = await register(app, { token_endpoint_auth_method: "client_secret_post" });
    expect(confidential.body.client_secret).toMatch(/^mcps_/);
    const clientId = confidential.body.client_id!;

    const code = () =>
      approve(app, clientId).then((r) => new URL(r.body.redirect_to).searchParams.get("code")!);
    const base = {
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: confidential.body.client_secret!,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    };
    expect(
      (await token(app, { ...base, code: await code(), code_verifier: "x".repeat(64) })).status,
    ).toBe(400);
    expect(
      (await token(app, { ...base, code: await code(), redirect_uri: `${REDIRECT}2` })).status,
    ).toBe(400);
    expect((await token(app, { ...base, code: await code(), client_secret: "wrong" })).status).toBe(
      401,
    );
    expect((await token(app, { ...base, code: await code() })).status).toBe(200);
  });

  it("requires a session and keeps approvals within the requested scopes", async () => {
    const signedOut = setup(false);
    const client = await register(signedOut.app);
    expect((await approve(signedOut.app, client.body.client_id!)).status).toBe(401);

    const { app } = setup();
    const registered = await register(app);
    expect((await approve(app, registered.body.client_id!, ["webhooks:manage"])).status).toBe(400);
    const form = await app.request("/v1/oauth/authorize", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({
        ...authorizeParams(registered.body.client_id!),
        scopes: ["crm:read"],
      }),
    });
    expect(form.status).toBe(415);
  });

  it("allows only safe redirect URIs and known scopes", async () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://evil.example.test/callback")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("https://client.example.test/cb#frag")).toBe(false);
    expect(requestedScopes("crm:read nonsense")).toEqual(["crm:read"]);
    expect(requestedScopes(undefined)).toContain("workspace:read");
    expect((await register(setup().app, { redirect_uris: ["http://evil.test/cb"] })).status).toBe(
      400,
    );
  });

  it("completes the MCP SDK client's discovery, registration and code exchange", async () => {
    const { app, prisma } = setup();
    const fetchFn = (url: string | URL, init?: RequestInit) => app.request(String(url), init);
    const saved: Record<string, unknown> = {};
    let authorizationUrl: URL | undefined;
    const provider: OAuthClientProvider = {
      redirectUrl: REDIRECT,
      clientMetadata: { client_name: "SDK client", redirect_uris: [REDIRECT] },
      clientInformation: () => saved.client as never,
      saveClientInformation: (info) => {
        saved.client = info;
      },
      tokens: () => saved.tokens as never,
      saveTokens: (tokens) => {
        saved.tokens = tokens;
      },
      redirectToAuthorization: (url) => {
        authorizationUrl = url;
      },
      saveCodeVerifier: (verifier) => {
        saved.verifier = verifier;
      },
      codeVerifier: () => saved.verifier as string,
    };
    const serverUrl = `${ORIGIN}/mcp/crm`;
    expect(await auth(provider, { serverUrl, fetchFn })).toBe("REDIRECT");
    expect(authorizationUrl?.origin + authorizationUrl!.pathname).toBe(`${ORIGIN}/oauth/authorize`);

    const approval = await app.request("/v1/oauth/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...Object.fromEntries(authorizationUrl!.searchParams),
        scopes: ["crm:read"],
      }),
    });
    const { redirect_to } = (await approval.json()) as { redirect_to: string };
    const authorizationCode = new URL(redirect_to).searchParams.get("code")!;
    expect(await auth(provider, { serverUrl, authorizationCode, fetchFn })).toBe("AUTHORIZED");
    expect(saved.tokens).toMatchObject({ token_type: "Bearer", scope: "crm:read" });
    expect(prisma.integrationCredential.rows).toHaveLength(1);
  });
});
