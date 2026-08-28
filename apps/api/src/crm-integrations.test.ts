import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  createCrmIntegrationService,
  crmOpenApiDocument,
  mountCrmIntegrationRoutes,
  parseCrmContactUpsert,
  parseCrmPageLimit,
  parseCrmUpdatedAfter,
  signCrmWebhook,
} from "./crm-integrations.js";

describe("CRM integration contract", () => {
  it("uses the deployment origin and bearer authentication", () => {
    const document = crmOpenApiDocument("https://manor.example.test") as {
      servers: Array<{ url: string }>;
      security: Array<Record<string, unknown>>;
      paths: Record<string, unknown>;
    };
    expect(document.servers).toEqual([{ url: "https://manor.example.test" }]);
    expect(document.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths).toHaveProperty("/v1/crm/contacts");
    expect(document.paths).toHaveProperty("/v1/crm/contacts/upsert");
    expect(document.paths).toHaveProperty("/v1/crm/contacts/{id}");
    expect(document.paths).toHaveProperty("/v1/crm/deals");
    expect(document.paths).toHaveProperty("/v1/crm/deals/{id}/move");
    expect(document.paths).toHaveProperty("/v1/webhooks/{id}");
  });

  it("requires a complete external identity or an email", () => {
    expect(parseCrmContactUpsert({ source: "newsletter" }).success).toBe(false);
    expect(parseCrmContactUpsert({ first_name: "Ada" }).success).toBe(false);
    expect(
      parseCrmContactUpsert({
        source: "newsletter",
        external_id: "subscriber-1",
        first_name: "Ada",
      }).success,
    ).toBe(true);
    expect(parseCrmContactUpsert({ email: "ada@example.com" }).success).toBe(true);
  });

  it("validates pagination and incremental-sync query values", () => {
    expect(parseCrmPageLimit(undefined)).toMatchObject({ success: true, data: 50 });
    expect(parseCrmPageLimit("100")).toMatchObject({ success: true, data: 100 });
    expect(parseCrmPageLimit("1.5").success).toBe(false);
    expect(parseCrmPageLimit("101").success).toBe(false);
    expect(parseCrmPageLimit("not-a-number").success).toBe(false);
    expect(parseCrmUpdatedAfter("2026-08-27T12:00:00Z")).toMatchObject({
      success: true,
      data: new Date("2026-08-27T12:00:00Z"),
    });
    expect(parseCrmUpdatedAfter("August 27, 2026").success).toBe(false);
  });

  it("signs the timestamp and exact raw webhook body", () => {
    expect(signCrmWebhook("whsec_test", "1724760000", '{"id":"evt_1"}')).toBe(
      "v1=df737807187592a4d7cadedf716c698547e5f03b12c39ebd614d77704ebae508",
    );
  });

  it("recovers abandoned deliveries, cleans retained data, and signs successful attempts", async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const update = vi.fn().mockResolvedValue({});
    const deleteExpiredKeys = vi.fn().mockResolvedValue({ count: 2 });
    const deleteRetainedEvents = vi.fn().mockResolvedValue({ count: 3 });
    const event = {
      id: "event_1",
      type: "contact.updated",
      createdAt: new Date("2026-08-27T12:00:00.000Z"),
      payload: { id: "contact_1" },
    };
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const service = createCrmIntegrationService({
      prisma: {
        crmWebhookDelivery: {
          updateMany,
          findMany: vi.fn().mockResolvedValue([
            {
              id: "delivery_1",
              attempts: 0,
              endpoint: {
                url: "https://hooks.example.test/manor",
                signingSecret: "encrypted-secret",
              },
              event,
            },
          ]),
          update,
        },
        integrationIdempotencyKey: { deleteMany: deleteExpiredKeys },
        crmWebhookEvent: { deleteMany: deleteRetainedEvents },
      } as never,
      secrets: { load: vi.fn(() => "whsec_test") } as never,
      fetch: fetch as never,
    });

    await service.deliverPending();

    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ status: "delivering" }) }),
    );
    expect(deleteExpiredKeys).toHaveBeenCalledOnce();
    expect(deleteRetainedEvents).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://hooks.example.test/manor");
    const body = String(init?.body);
    const headers = new Headers(init?.headers);
    expect(headers.get("x-manor-signature")).toBe(
      signCrmWebhook("whsec_test", headers.get("x-manor-timestamp")!, body),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: "delivery_1" },
      data: { status: "delivered", deliveredAt: expect.any(Date), lastError: null },
    });
  });

  it("moves an eighth failed webhook attempt to the dead-letter state", async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = createCrmIntegrationService({
      prisma: {
        crmWebhookDelivery: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findMany: vi.fn().mockResolvedValue([
            {
              id: "delivery_8",
              attempts: 7,
              endpoint: {
                url: "https://hooks.example.test/manor",
                signingSecret: "encrypted-secret",
              },
              event: {
                id: "event_8",
                type: "deal.updated",
                createdAt: new Date("2026-08-27T12:00:00.000Z"),
                payload: { id: "deal_1" },
              },
            },
          ]),
          update,
        },
        integrationIdempotencyKey: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        crmWebhookEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      } as never,
      secrets: { load: vi.fn(() => "whsec_test") } as never,
      fetch: vi.fn(async () => new Response(null, { status: 503 })) as never,
    });

    await service.deliverPending();

    expect(update).toHaveBeenCalledWith({
      where: { id: "delivery_8" },
      data: {
        status: "dead",
        nextAttemptAt: expect.any(Date),
        lastError: "HTTP 503",
      },
    });
  });

  it("serves authenticated Streamable HTTP MCP initialization requests", async () => {
    const app = new Hono();
    const mounted = mountCrmIntegrationRoutes(app, {
      prisma: {} as never,
      secrets: {} as never,
      resolveActor: async () => null,
      service: {
        authenticate: vi.fn(async () => ({
          credentialId: "credential_1",
          workspaceId: "workspace_1",
          userId: "user_1",
          scopes: ["crm:read"],
        })),
        deliverPending: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      } as never,
    });

    try {
      const response = await app.request("/mcp/crm", {
        method: "POST",
        headers: {
          authorization: "Bearer manor_test",
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "crm-contract-test", version: "1.0.0" },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: { serverInfo: { name: "Manor CRM" } },
      });
    } finally {
      await mounted.stop();
    }
  });
});
