import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TransactionalEmail, TransactionalEmailProvider } from "@rakazo/adapter-kit";
import { InMemoryRealtimeFanout } from "@rakazo/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

type App = { request: (input: string, init?: RequestInit) => Promise<Response> };
type AppHandles = Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts").createApp>>;
type Form = { id: string; slug: string; enabled: boolean; eventStartsAt: string | null };

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

const SITE = "https://events.example.test";

describeWithDatabase("organization public forms", () => {
  let handles: AppHandles;
  let app: App;
  let owner: string;
  let organizationId: string;
  const sent: TransactionalEmail[] = [];
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const eventSlug = `demo-night-${stamp}`.replace(/[^a-z0-9-]/g, "-");
  const scorecardSlug = `readiness-${stamp}`.replace(/[^a-z0-9-]/g, "-");
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-public-forms-"));
  const email: TransactionalEmailProvider = {
    describe: () => ({
      id: "capture",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { transactional: true },
    }),
    send: async (message) => {
      sent.push(message);
    },
  };

  const baseForm = {
    enabled: true,
    allowedOrigins: [SITE],
    notifyEmail: "owner@example.test",
    senderName: "Demo Host",
    signature: "Sam",
    message: null,
    eventStartsAt: null,
    eventMinutes: null,
    eventTimeZone: null,
    joinUrl: null,
    bookingUrl: null,
  };

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      encryptionKey: "offline-public-forms-test-key",
      signupsEnabled: "true",
      realtime: new InMemoryRealtimeFanout(),
      email,
    });
    app = handles.app;
    owner = await signup(app, `forms-owner-${stamp}@rakazo.test`);
    const user = await handles.prisma.user.findFirstOrThrow({
      where: { email: `forms-owner-${stamp}@rakazo.test` },
    });
    organizationId = (await handles.prisma.member.findFirstOrThrow({ where: { userId: user.id } }))
      .organizationId;
  });

  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("lets the owner save an event form and signs people up from its allowed site", async () => {
    const saved = await rpc<Form>(app, owner, "publicForms/save", {
      ...baseForm,
      slug: eventSlug,
      kind: "event",
      title: "Demo Night",
      crmTag: "Demo Night",
      message: "Bring questions.",
      eventStartsAt: "2026-09-24T19:00:00-04:00",
      eventMinutes: 60,
      eventTimeZone: "America/New_York",
      joinUrl: "https://us06web.zoom.us/j/1234567890",
    });
    expect(saved.eventStartsAt).toBe("2026-09-24T23:00:00.000Z");
    expect(await rpc(app, owner, "publicForms/list")).toMatchObject({
      canManage: true,
      forms: [expect.objectContaining({ slug: eventSlug })],
    });

    // Only the form's own site gets CORS access, and never with credentials.
    const allowed = await preflight(`/v1/public/${eventSlug}`, SITE);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();
    const other = await preflight(`/v1/public/${eventSlug}`, "https://other.example.test");
    expect(other.headers.get("access-control-allow-origin") ?? "").toBe("");

    const response = await submit(`/v1/public/${eventSlug}`, {
      first_name: "Ada",
      email: "Ada@Example.test",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    const contact = await handles.prisma.crmContact.findFirstOrThrow({
      where: { organizationId, email: "ada@example.test" },
      include: { tags: { include: { tag: true } } },
    });
    expect(contact.firstName).toBe("Ada");
    expect(contact.tags.map((link) => link.tag.name)).toEqual(["Demo Night"]);

    const confirmation = sent.find((message) => message.to === "ada@example.test");
    expect(confirmation).toMatchObject({ subject: "You're in: Demo Night", fromName: "Demo Host" });
    expect(confirmation?.text).toContain("https://us06web.zoom.us/j/1234567890");
    expect(confirmation?.text).toContain("Thursday, September 24, 7:00 to 8:00 PM EDT");
    expect(confirmation?.text).toContain("Bring questions.");
    expect(sent.find((message) => message.to === "owner@example.test")?.subject).toBe(
      "Demo Night signup: Ada",
    );
  });

  it("scores scorecard answers into CRM notes and emails the results", async () => {
    await rpc<Form>(app, owner, "publicForms/save", {
      ...baseForm,
      slug: scorecardSlug,
      kind: "scorecard",
      title: "Automation Readiness",
      crmTag: "Automation Readiness",
      bookingUrl: "https://booking.example.test/call",
    });
    const response = await submit(`/v1/public/forms/${scorecardSlug}`, {
      name: "Grace Hopper",
      email: "grace@example.test",
      business_type: "Property management",
      score: 0,
      weakest_areas: ["Invoicing"],
      answers: [
        { question: "Invoices go out automatically", value: 3 },
        { question: "Leads get a same-day reply", value: 2 },
      ],
    });
    expect(response.status).toBe(200);
    const contact = await handles.prisma.crmContact.findFirstOrThrow({
      where: { organizationId, email: "grace@example.test" },
    });
    expect(contact).toMatchObject({
      firstName: "Grace",
      lastName: "Hopper",
      company: "Property management",
    });
    expect(contact.notes).toContain("Score: 5/36");
    expect(contact.notes).toContain("Band: Foundation first");
    const results = sent.find((message) => message.to === "grace@example.test");
    expect(results?.subject).toBe("Your Automation Readiness score");
    expect(results?.text).toContain("https://booking.example.test/call");
  });

  it("rejects bad input, turned-off forms, and other organizations", async () => {
    expect(
      (await submit(`/v1/public/${eventSlug}`, { email: "no-name@example.test" })).status,
    ).toBe(400);
    expect((await submit("/v1/public/forms/does-not-exist", {})).status).toBe(404);

    const form = (await rpc<{ forms: Form[] }>(app, owner, "publicForms/list")).forms.find(
      (entry) => entry.slug === eventSlug,
    )!;
    const outsider = await signup(app, `forms-outsider-${stamp}@rakazo.test`);
    expect(await rpc(app, outsider, "publicForms/list")).toMatchObject({ forms: [] });
    expect((await raw(app, outsider, "publicForms/remove", { id: form.id })).status).toBe(404);
    const taken = await raw(app, outsider, "publicForms/save", {
      ...baseForm,
      slug: eventSlug,
      kind: "event",
      title: "Copy",
      crmTag: "Copy",
    });
    expect(taken.status).toBe(409);

    await rpc(app, owner, "publicForms/save", {
      ...baseForm,
      id: form.id,
      slug: eventSlug,
      kind: "event",
      title: "Demo Night",
      crmTag: "Demo Night",
      enabled: false,
    });
    expect(
      (await submit(`/v1/public/${eventSlug}`, { first_name: "Late", email: "late@example.test" }))
        .status,
    ).toBe(404);
  });

  function submit(pathname: string, body: unknown) {
    return app.request(pathname, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE, "cf-connecting-ip": stamp },
      body: JSON.stringify(body),
    });
  }

  function preflight(pathname: string, origin: string) {
    return app.request(pathname, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
  }
});

async function signup(app: App, email: string) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ email, password: "password12", name: "Forms Owner" }),
  });
  if (!response.ok) throw new Error(`signup failed ${response.status}: ${await response.text()}`);
  return sessionCookieHeader(response);
}

function raw(app: App, cookie: string, proc: string, body: unknown = {}) {
  return app.request(`/rpc/${proc}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ json: body }),
  });
}

async function rpc<T>(app: App, cookie: string, proc: string, body: unknown = {}): Promise<T> {
  const response = await raw(app, cookie, proc, body);
  const parsed = (await response.json()) as { json?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(`${proc} ${response.status}: ${parsed.error?.message}`);
  return parsed.json as T;
}
