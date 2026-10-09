import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type Actor, INTEGRATION_SCOPES, type IntegrationScope } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { Context, Hono } from "hono";
import * as z from "zod";
import { issueIntegrationToken } from "./crm-integrations.js";

// OAuth 2.1 authorization server for MCP clients that cannot send a static bearer
// header (claude.ai and ChatGPT connectors). A grant is an ordinary integration
// credential, so the MCP and REST routes authenticate it unchanged, and revoking it
// in API access ends the connection.

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const MCP_RESOURCES = ["/mcp/crm", "/mcp/workspace"] as const;

/** Paths any origin may call without credentials: discovery, registration and token exchange. */
export function isOAuthPublicPath(path: string) {
  return (
    path.startsWith("/.well-known/oauth-") || path === "/oauth/register" || path === "/oauth/token"
  );
}

const RegistrationInput = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_post", "client_secret_basic"])
    .optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

const AuthorizationRequest = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(2000),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2000).optional(),
  scope: z.string().max(1000).optional(),
  resource: z.string().max(2000).optional(),
});

const Approval = AuthorizationRequest.extend({
  scopes: z.array(z.enum(INTEGRATION_SCOPES)).min(1).max(INTEGRATION_SCOPES.length),
});

type OAuthDeps = {
  prisma: PrismaClient;
  resolveActor: (request: Request) => Promise<Actor | null>;
  publicOrigin: (request: Request) => string;
  now?: () => Date;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sameHash(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Loopback http, https, or a native app's private scheme (RFC 8252); never fragments. */
export function isAllowedRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return (
    /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
    !["javascript:", "data:", "file:", "blob:", "vbscript:"].includes(url.protocol)
  );
}

/** Requested scopes the server knows; an empty request means every scope. */
export function requestedScopes(scope: string | undefined): IntegrationScope[] {
  const requested = (scope ?? "")
    .split(/\s+/)
    .filter((value): value is IntegrationScope =>
      INTEGRATION_SCOPES.includes(value as IntegrationScope),
    );
  return requested.length ? [...new Set(requested)] : [...INTEGRATION_SCOPES];
}

function oauthError(c: Context, error: string, description: string, status: 400 | 401 = 400) {
  return c.json({ error, error_description: description }, status, { "cache-control": "no-store" });
}

async function formBody(c: Context): Promise<Record<string, string>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await c.req.json().catch(() => null);
    return body && typeof body === "object"
      ? Object.fromEntries(
          Object.entries(body).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  }
  const body = await c.req.parseBody().catch(() => ({}));
  return Object.fromEntries(
    Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function clientCredentials(c: Context, body: Record<string, string>) {
  const basic = c.req.header("authorization");
  if (basic?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(basic.slice(6).trim(), "base64").toString("utf8");
    const split = decoded.indexOf(":");
    if (split > 0)
      return {
        clientId: decodeURIComponent(decoded.slice(0, split)),
        clientSecret: decodeURIComponent(decoded.slice(split + 1)),
      };
  }
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

export function mountMcpOAuthProvider(app: Hono, deps: OAuthDeps) {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());

  // MCP clients discover sign-in from this challenge on an unauthenticated request.
  app.use("/mcp/*", async (c, next) => {
    await next();
    const path = c.req.path.replace(/\/$/, "");
    if (c.res.status !== 401 || !MCP_RESOURCES.includes(path as (typeof MCP_RESOURCES)[number]))
      return;
    const metadata = `${deps.publicOrigin(c.req.raw)}/.well-known/oauth-protected-resource${path}`;
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set("WWW-Authenticate", `Bearer resource_metadata="${metadata}"`);
  });

  app.get("/.well-known/oauth-protected-resource/*", (c) => {
    const origin = deps.publicOrigin(c.req.raw);
    const path = c.req.path.slice("/.well-known/oauth-protected-resource".length);
    if (!MCP_RESOURCES.includes(path as (typeof MCP_RESOURCES)[number])) return c.notFound();
    return c.json(protectedResource(origin, `${origin}${path}`));
  });
  app.get("/.well-known/oauth-protected-resource", (c) => {
    const origin = deps.publicOrigin(c.req.raw);
    return c.json(protectedResource(origin, origin));
  });
  app.get("/.well-known/oauth-authorization-server", (c) => {
    const origin = deps.publicOrigin(c.req.raw);
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: INTEGRATION_SCOPES,
      authorization_response_iss_parameter_supported: true,
    });
  });

  app.post("/oauth/register", async (c) => {
    const parsed = RegistrationInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return oauthError(c, "invalid_client_metadata", z.prettifyError(parsed.error));
    const input = parsed.data;
    const invalid = input.redirect_uris.find((uri) => !isAllowedRedirectUri(uri));
    if (invalid)
      return oauthError(c, "invalid_redirect_uri", `Redirect URI not allowed: ${invalid}`);
    const method = input.token_endpoint_auth_method ?? "none";
    const clientId = `mcp_${randomBytes(16).toString("base64url")}`;
    const clientSecret =
      method === "none" ? undefined : `mcps_${randomBytes(30).toString("base64url")}`;
    const name = input.client_name ?? "MCP client";
    await prisma.oAuthClient.create({
      data: {
        id: clientId,
        name,
        redirectUris: [...new Set(input.redirect_uris)],
        secretHash: clientSecret ? sha256(clientSecret) : null,
      },
    });
    return c.json(
      {
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(now().getTime() / 1000),
        client_name: name,
        redirect_uris: input.redirect_uris,
        token_endpoint_auth_method: method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
      { "cache-control": "no-store" },
    );
  });

  async function findClient(clientId: string, redirectUri: string) {
    const client = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
    if (!client) return null;
    const uris = Array.isArray(client.redirectUris) ? client.redirectUris : [];
    return uris.includes(redirectUri) ? client : null;
  }

  // The consent page reads the request it is about to approve.
  app.get("/v1/oauth/authorize", async (c) => {
    const actor = await deps.resolveActor(c.req.raw);
    if (!actor) return c.json({ error: { message: "Authentication required" } }, 401);
    const parsed = AuthorizationRequest.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { message: "This authorization request is invalid." } }, 400);
    const client = await findClient(parsed.data.client_id, parsed.data.redirect_uri);
    if (!client) return c.json({ error: { message: "Unknown client or redirect address." } }, 400);
    return c.json({
      client_name: client.name,
      redirect_host: new URL(parsed.data.redirect_uri).host,
      scopes: requestedScopes(parsed.data.scope),
    });
  });

  // Approval binds the code to the session's selected space; a denial never reaches here.
  app.post("/v1/oauth/authorize", async (c) => {
    const actor = await deps.resolveActor(c.req.raw);
    if (!actor) return c.json({ error: { message: "Authentication required" } }, 401);
    // JSON only, so a cross-site form post cannot approve on the user's behalf.
    if (!c.req.header("content-type")?.startsWith("application/json"))
      return c.json({ error: { message: "Expected JSON" } }, 415);
    const parsed = Approval.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: { message: "This authorization request is invalid." } }, 400);
    const request = parsed.data;
    const client = await findClient(request.client_id, request.redirect_uri);
    if (!client) return c.json({ error: { message: "Unknown client or redirect address." } }, 400);
    const allowed = requestedScopes(request.scope);
    if (request.scopes.some((scope) => !allowed.includes(scope)))
      return c.json({ error: { message: "Scopes exceed the request." } }, 400);
    const code = randomBytes(32).toString("base64url");
    await prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: now() } } });
    await prisma.oAuthAuthorizationCode.create({
      data: {
        codeHash: sha256(code),
        clientId: client.id,
        spaceId: actor.spaceId,
        userId: actor.userId,
        redirectUri: request.redirect_uri,
        codeChallenge: request.code_challenge,
        scopes: [...new Set(request.scopes)],
        expiresAt: new Date(now().getTime() + CODE_TTL_MS),
      },
    });
    const redirect = new URL(request.redirect_uri);
    redirect.searchParams.set("code", code);
    if (request.state) redirect.searchParams.set("state", request.state);
    redirect.searchParams.set("iss", deps.publicOrigin(c.req.raw));
    return c.json({ redirect_to: redirect.href });
  });

  app.post("/oauth/token", async (c) => {
    const body = await formBody(c);
    const { clientId, clientSecret } = clientCredentials(c, body);
    if (!clientId) return oauthError(c, "invalid_client", "client_id is required", 401);
    const client = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
    if (
      !client ||
      (client.secretHash && (!clientSecret || !sameHash(client.secretHash, sha256(clientSecret))))
    )
      return oauthError(c, "invalid_client", "Client authentication failed", 401);

    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.code_verifier || !body.redirect_uri)
        return oauthError(
          c,
          "invalid_request",
          "code, code_verifier and redirect_uri are required",
        );
      const row = await prisma.oAuthAuthorizationCode.findUnique({
        where: { codeHash: sha256(body.code) },
      });
      // Deleting first makes the code single-use even under concurrent exchanges.
      const consumed = row
        ? await prisma.oAuthAuthorizationCode.deleteMany({ where: { id: row.id } })
        : { count: 0 };
      if (
        !row ||
        consumed.count !== 1 ||
        row.expiresAt <= now() ||
        row.clientId !== client.id ||
        row.redirectUri !== body.redirect_uri ||
        pkceChallenge(body.code_verifier) !== row.codeChallenge
      )
        return oauthError(c, "invalid_grant", "The authorization code is invalid or expired");
      const access = issueIntegrationToken();
      const refresh = issueIntegrationToken();
      const scopes = Array.isArray(row.scopes) ? (row.scopes as IntegrationScope[]) : [];
      await prisma.integrationCredential.create({
        data: {
          spaceId: row.spaceId,
          createdByUserId: row.userId,
          name: client.name,
          tokenPrefix: access.tokenPrefix,
          tokenHash: access.tokenHash,
          scopes,
          expiresAt: new Date(now().getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
          oauthClientId: client.id,
          refreshTokenHash: refresh.tokenHash,
          refreshExpiresAt: new Date(now().getTime() + REFRESH_TOKEN_TTL_MS),
        },
      });
      return tokenResponse(c, access.token, refresh.token, scopes);
    }

    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) return oauthError(c, "invalid_request", "refresh_token is required");
      const previous = sha256(body.refresh_token);
      const row = await prisma.integrationCredential.findUnique({
        where: { refreshTokenHash: previous },
      });
      if (
        !row ||
        row.oauthClientId !== client.id ||
        row.revokedAt ||
        !row.refreshExpiresAt ||
        row.refreshExpiresAt <= now()
      )
        return oauthError(c, "invalid_grant", "The refresh token is invalid or expired");
      const access = issueIntegrationToken();
      const refresh = issueIntegrationToken();
      // Rotation: the old refresh token matches at most one concurrent exchange.
      const rotated = await prisma.integrationCredential.updateMany({
        where: { id: row.id, refreshTokenHash: previous, revokedAt: null },
        data: {
          tokenPrefix: access.tokenPrefix,
          tokenHash: access.tokenHash,
          expiresAt: new Date(now().getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
          refreshTokenHash: refresh.tokenHash,
          refreshExpiresAt: new Date(now().getTime() + REFRESH_TOKEN_TTL_MS),
        },
      });
      if (rotated.count !== 1)
        return oauthError(c, "invalid_grant", "The refresh token is invalid or expired");
      const scopes = Array.isArray(row.scopes) ? (row.scopes as IntegrationScope[]) : [];
      return tokenResponse(c, access.token, refresh.token, scopes);
    }

    return oauthError(c, "unsupported_grant_type", "Use authorization_code or refresh_token");
  });
}

function protectedResource(origin: string, resource: string) {
  return {
    resource,
    authorization_servers: [origin],
    scopes_supported: INTEGRATION_SCOPES,
    bearer_methods_supported: ["header"],
  };
}

function tokenResponse(c: Context, accessToken: string, refreshToken: string, scopes: string[]) {
  return c.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    },
    200,
    { "cache-control": "no-store", pragma: "no-cache" },
  );
}
