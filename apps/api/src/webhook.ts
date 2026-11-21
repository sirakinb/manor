import { createHash } from "node:crypto";
import { SecretStoreUnavailableError } from "@rakazo/adapter-kit";
import { routineWebhookToken } from "@rakazo/adapters";
import { hasValidBearerToken } from "@rakazo/core";
import type { Context, Hono } from "hono";
import { mountGithubWebhookRoute } from "./github-webhook.js";
import { readBoundedBody } from "./http-body.js";
import {
  deliverWebhookEvent,
  formatWebhookPrompt,
  type WebhookDeps as InboundWebhookDeps,
  type WebhookEvents as InboundWebhookEvents,
  loadWebhookTarget,
  parseWebhookPayload,
  WEBHOOK_MAX_BODY_BYTES,
  type WebhookSecretCache,
} from "./webhook-inbound.js";

export {
  formatGithubEventPrompt,
  githubEventName,
  githubWebhookPath,
  hasValidGithubSignature,
} from "./github-webhook.js";
export {
  formatUntrustedDeliveryPayload,
  formatWebhookPrompt,
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_SECRET_KIND,
  type WebhookTarget,
} from "./webhook-inbound.js";

/** Inbound webhook events, plus the routine a per-routine webhook run belongs to. */
export type WebhookEvents = {
  sendUserMessage(
    input: Parameters<InboundWebhookEvents["sendUserMessage"]>[0] & { routineId?: string },
  ): ReturnType<InboundWebhookEvents["sendUserMessage"]>;
};

export type WebhookDeps = Omit<InboundWebhookDeps, "events"> & { events: WebhookEvents };

export function webhookPath(botId: string): string {
  return `/api/v1/bots/${botId}/webhook`;
}

export function mountWebhookHttpRoutes(app: Hono, deps: WebhookDeps) {
  const secretCache: WebhookSecretCache = new Map();

  const receive = async (c: Context) => {
    const unauthorized = () => c.json({ error: "Unauthorized" }, 401);
    const routineId = c.req.param("routineId");

    // Reject oversized bodies before target lookup so size limits do not reveal active bots.
    const raw = await readBoundedBody(c.req.raw, WEBHOOK_MAX_BODY_BYTES);
    if (raw === null) {
      return c.json({ error: "Payload too large" }, 413);
    }

    let target: Awaited<ReturnType<typeof loadWebhookTarget>>;
    try {
      target = await loadWebhookTarget(deps, secretCache, c.req.param("botId") ?? "");
    } catch (error) {
      if (error instanceof SecretStoreUnavailableError) {
        return c.json({ error: "Service unavailable" }, 503);
      }
      throw error;
    }

    // Senders like cal.com and form builders cannot set headers — they may
    // carry the secret as a ?token= query parameter instead.
    const authorization = c.req.header("authorization");
    const queryToken = c.req.query("token");
    const presents = (expected: string) =>
      hasValidBearerToken(authorization, expected) ||
      (queryToken ? hasValidBearerToken(`Bearer ${queryToken}`, expected) : false);

    // Same 401 for missing bot, missing secret, and bad bearer so bot ids are not enumerable.
    // A routine-scoped token only opens its own routine's endpoint.
    if (
      !target ||
      !(
        presents(target.expected) ||
        (routineId ? presents(routineWebhookToken(target.expected, routineId)) : false)
      )
    ) {
      return unauthorized();
    }

    const payload = parseWebhookPayload(raw, c.req.header("content-type"));
    const eventPrompt = formatWebhookPrompt(payload);

    const webhookRoutines = await deps.prisma.routine.findMany({
      where: {
        botId: target.bot.id,
        spaceId: target.bot.spaceId,
        active: true,
        webhookEnabled: true,
        ...(routineId ? { id: routineId } : {}),
      },
      select: {
        id: true,
        name: true,
        prompt: true,
        threadId: true,
        userId: true,
        modelProvider: true,
        modelId: true,
        thinkingLevel: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });

    if (routineId && webhookRoutines.length === 0) {
      return c.json({ error: "Active webhook routine not found" }, 404);
    }
    const routine = routineId ? webhookRoutines[0] : undefined;
    let threadId = target.threadId;
    if (routine?.threadId && routine.threadId !== threadId) {
      const thread = await deps.prisma.thread.findFirst({
        where: {
          id: routine.threadId,
          spaceId: target.bot.spaceId,
          OR: [
            { botId: target.bot.id },
            { group: { archivedAt: null, members: { some: { botId: target.bot.id } } } },
          ],
        },
        select: { id: true },
      });
      if (!thread) return c.json({ error: "Routine conversation unavailable" }, 404);
      threadId = thread.id;
    }

    const idempotencyKey =
      c.req.header("idempotency-key")?.trim() ||
      c.req.header("x-idempotency-key")?.trim() ||
      (typeof payload.id === "string" ? payload.id.trim() : "") ||
      (typeof payload.event_id === "string" ? payload.event_id.trim() : "") ||
      undefined;
    // A per-routine delivery dedupes within its routine, not across the whole bot.
    const routineNonce =
      routineId && idempotencyKey
        ? `webhook:${target.bot.id}:${routineId}:${createHash("sha256").update(idempotencyKey).digest("base64url")}`
        : undefined;

    let dispatchFailed = false;
    const delivered = await deliverWebhookEvent(
      {
        events: {
          sendUserMessage: (input) =>
            deps.events.sendUserMessage({
              ...input,
              ...(routineId ? { routineId } : {}),
              ...(routineNonce ? { clientNonce: routineNonce } : {}),
            }),
        },
        jobs: {
          enqueue: async (job) => {
            try {
              return await deps.jobs.enqueue(job);
            } catch (error) {
              dispatchFailed = true;
              throw error;
            }
          },
        },
      },
      {
        bot: { ...target.bot, userId: routine?.userId ?? target.bot.userId },
        threadId,
      },
      {
        prompt: eventPrompt,
        routines: webhookRoutines,
        source: "webhook",
        idempotencyKey,
      },
    );

    // The message is stored; a sender that retries with the same event ID is deduplicated.
    if (dispatchFailed) {
      return c.json(
        { error: "Delivery queued but dispatch unavailable; retry with the same event ID" },
        503,
      );
    }
    return c.json(delivered);
  };
  app.post("/api/v1/bots/:botId/webhook", receive);
  app.post("/api/v1/bots/:botId/routines/:routineId/webhook", receive);

  mountGithubWebhookRoute(app, deps, secretCache);
}
