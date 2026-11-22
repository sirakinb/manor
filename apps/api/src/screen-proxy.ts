import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { hasActiveComputerControl } from "@rakazo/adapters";
import { openScreenCapability, SCREEN_TARGET_ENDPOINT } from "@rakazo/core/node/screen-capability";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import type { Hono } from "hono";
import { requestBodyLimit } from "./request-body-limit.js";

// Manor's app-port preview links keep their own signed URL scheme.
const PREVIEW_PROXY_TTL_MS = 60 * 60_000;
const PREVIEW_PROXY_PREFIX = "/preview";
const PREVIEW_POLICY = "app";

export function mountScreenTarget(app: Hono, prisma: PrismaClient, secret: string) {
  app.post(SCREEN_TARGET_ENDPOINT, requestBodyLimit(16 * 1024), async (c) => {
    c.header("cache-control", "no-store");
    const supplied = Buffer.from(c.req.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (
      !secret ||
      supplied.length === 0 ||
      !timingSafeEqual(
        createHash("sha256").update(supplied).digest(),
        createHash("sha256").update(expected).digest(),
      )
    )
      return c.body(null, 403);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.path !== "string") return c.body(null, 403);
    const capability = openScreenCapability(body.path, secret);
    if (!capability) return c.body(null, 403);
    const { scope, target } = capability;
    // The sealed capability, not a session, names the bot and computer.
    const bot = await runAsSystem("check a screen proxy capability", () =>
      prisma.bot.findFirst({
        where: {
          id: scope.botId,
          computerId: scope.computerId,
          archivedAt: null,
          screenGeneration: scope.botGeneration,
        },
        select: {
          computer: {
            select: {
              screenGeneration: true,
              providerRef: true,
              state: true,
              controlHolder: true,
              controlLeaseId: true,
              controlBotId: true,
              controlLeaseExpiresAt: true,
            },
          },
        },
      }),
    );
    const computer = bot?.computer;
    if (
      !computer ||
      computer.screenGeneration !== scope.computerGeneration ||
      !computer.providerRef ||
      !["running", "booting", "suspending"].includes(computer.state) ||
      (target.interactive &&
        (!hasActiveComputerControl(computer) ||
          !scope.controlLeaseId ||
          computer.controlLeaseId !== scope.controlLeaseId ||
          computer.controlBotId !== scope.botId))
    )
      return c.body(null, 403);
    return c.json(target);
  });
}

/**
 * Signed capability for an app port inside a bot's computer (a dev server, a
 * static site). Same HMAC scheme as the screen proxy but a distinct policy, so
 * a screen capability can never be replayed against an app port or vice versa.
 */
export function addPreviewProxyCapability(
  target: { hostname: string; port: number },
  secret: string,
  proxyOrigin: string,
  requestPath = "/",
  now = Date.now(),
): string {
  const expiresAt = now + PREVIEW_PROXY_TTL_MS;
  const host = Buffer.from(target.hostname).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${target.hostname}:${target.port}:${PREVIEW_POLICY}:${expiresAt}`)
    .digest("base64url");
  const origin = new URL(proxyOrigin).origin;
  const path = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  return `${origin}${PREVIEW_PROXY_PREFIX}/${host}/${target.port}/${expiresAt}.${signature}${path}`;
}
