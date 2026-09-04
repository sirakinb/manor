import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

type App = { request: (input: string, init?: RequestInit) => Promise<Response> };
type AppHandles = Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts").createApp>>;

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

describeWithDatabase("CRM public integrations", () => {
  let handles: AppHandles;
  let app: App;
  let cookie: string;
  let token: string;
  let organizationId: string;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-crm-integrations-"));

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      encryptionKey: "offline-crm-integration-test-key",
      signupsEnabled: "true",
    });
    app = handles.app;
    cookie = await signup(app, `crm-integrations-${stamp}@rakazo.test`);
    const response = await app.request("/v1/integration-credentials", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Newsletter sync",
        scopes: ["crm:read", "crm:write", "webhooks:manage"],
      }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; token: string };
    token = created.token;
    // The CRM is account-wide: pipelines hang off the organization, not the space.
    const credential = await handles.prisma.integrationCredential.findUniqueOrThrow({
      where: { id: created.id },
    });
    organizationId = (
      await handles.prisma.space.findUniqueOrThrow({ where: { id: credential.spaceId } })
    ).organizationId;
  });

  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("stores only a token hash and enforces CRM scopes", async () => {
    expect(token).toMatch(/^manor_/);
    const row = await handles.prisma.integrationCredential.findFirstOrThrow({
      where: { name: "Newsletter sync" },
    });
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenPrefix).toContain("…");

    const unauthenticated = await app.request("/v1/crm/contacts");
    expect(unauthenticated.status).toBe(401);

    const readOnlyResponse = await app.request("/v1/integration-credentials", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Read only", scopes: ["crm:read"] }),
    });
    const readOnlyCredential = (await readOnlyResponse.json()) as { id: string; token: string };
    const forbidden = await app.request("/v1/crm/contacts/upsert", {
      method: "POST",
      headers: {
        authorization: `Bearer ${readOnlyCredential.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "reader@example.com", first_name: "Reader" }),
    });
    expect(forbidden.status).toBe(403);

    const revoked = await app.request(`/v1/integration-credentials/${readOnlyCredential.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(revoked.status).toBe(200);
    const afterRevocation = await app.request("/v1/crm/contacts", {
      headers: { authorization: `Bearer ${readOnlyCredential.token}` },
    });
    expect(afterRevocation.status).toBe(401);
  });

  it("upserts by external identity without duplicating contacts", async () => {
    const first = await upsert({
      source: "website-newsletter",
      external_id: "subscriber-1042",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      tags: ["newsletter", "website"],
    });
    expect(first).toMatchObject({
      created: true,
      contact: { first_name: "Ada" },
    });
    expect((first.contact as { tags: string[] }).tags).toEqual(
      expect.arrayContaining(["newsletter", "website"]),
    );

    const second = await upsert({
      source: "website-newsletter",
      external_id: "subscriber-1042",
      first_name: "Augusta Ada",
      email: "ada@example.com",
    });
    expect(second).toMatchObject({ created: false, contact: { first_name: "Augusta Ada" } });
    expect(await handles.prisma.crmContact.count({ where: { email: "ada@example.com" } })).toBe(1);
    expect(await handles.prisma.crmContactExternalId.count()).toBe(1);
  });

  it("replays idempotent requests and lists source identities", async () => {
    const body = {
      source: "website-newsletter",
      external_id: "subscriber-idempotent",
      first_name: "Grace",
      email: "grace@example.com",
    };
    const request = () =>
      app.request("/v1/crm/contacts/upsert", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "signup-grace-1",
        },
        body: JSON.stringify(body),
      });
    const first = await request();
    const second = await request();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());

    const list = await app.request("/v1/crm/contacts?limit=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.status).toBe(200);
    const firstPage = (await list.json()) as {
      data: Array<{ external_ids: Array<{ source: string; external_id: string }> }>;
      next_cursor: string | null;
    };
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const next = await app.request(
      `/v1/crm/contacts?limit=100&cursor=${encodeURIComponent(firstPage.next_cursor!)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const secondPage = (await next.json()) as typeof firstPage;
    expect(secondPage.data.flatMap((contact) => contact.external_ids)).toContainEqual({
      source: "website-newsletter",
      external_id: "subscriber-idempotent",
    });
  });

  it("publishes a discoverable OpenAPI contract", async () => {
    const response = await app.request("/v1/openapi.json");
    expect(response.status).toBe(200);
    const document = (await response.json()) as { paths: Record<string, unknown> };
    expect(document.paths).toHaveProperty("/v1/crm/contacts/upsert");
    expect(document.paths).toHaveProperty("/v1/webhooks");
  });

  it("lists pipelines and creates, updates, and moves deals", async () => {
    const pipeline = await handles.prisma.crmPipeline.create({
      data: {
        organizationId,
        name: `Public API ${stamp}`,
        stages: {
          create: [
            { name: "Lead", position: 0 },
            { name: "Won", position: 1 },
          ],
        },
      },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    const pipelines = await app.request("/v1/crm/pipelines", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pipelines.status).toBe(200);
    expect(await pipelines.json()).toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ id: pipeline.id })]),
    });

    const createdResponse = await app.request("/v1/crm/deals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": `deal-${stamp}`,
      },
      body: JSON.stringify({
        pipeline_id: pipeline.id,
        stage_id: pipeline.stages[0]!.id,
        title: "Website implementation",
        value: 4200,
      }),
    });
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()) as { deal: { id: string } };

    const updated = await app.request(`/v1/crm/deals/${created.deal.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "won" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ deal: { status: "won" } });

    const moved = await app.request(`/v1/crm/deals/${created.deal.id}/move`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ stage_id: pipeline.stages[1]!.id }),
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ deal: { stage_id: pipeline.stages[1]!.id } });
  });

  it("rejects webhook targets that resolve inside the private network", async () => {
    const response = await app.request("/v1/webhooks", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Unsafe endpoint",
        url: "https://127.0.0.1/webhooks/manor",
        events: ["contact.updated"],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining("private host") },
    });
  });

  it("serves the CRM MCP endpoint with machine authentication", async () => {
    const unauthenticated = await app.request("/mcp/crm", { method: "POST" });
    expect(unauthenticated.status).toBe(401);

    const initialized = await app.request("/mcp/crm", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
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
          clientInfo: { name: "crm-integration-test", version: "1.0.0" },
        },
      }),
    });
    expect(initialized.status).toBe(200);
    expect(await initialized.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "Manor CRM" } },
    });
  });

  async function upsert(body: Record<string, unknown>) {
    const response = await app.request("/v1/crm/contacts/upsert", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<Record<string, unknown>>;
  }
});

async function signup(app: App, email: string) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ email, password: "password12", name: "CRM Integrations" }),
  });
  if (!response.ok) throw new Error(`signup failed ${response.status}: ${await response.text()}`);
  return sessionCookieHeader(response);
}
