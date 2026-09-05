import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioEmulator } from "@rakazo/adapters";
import type { SpaceNavigation } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
type AppHandles = Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts").createApp>>;

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

// The JRH brand's hostname from packages/brands; sign-ups arriving on it join
// the organization whose brandId is "jrh".
const BRAND_ORIGIN = "https://jrhmanor.agentworkspace.cloud";
const DEFAULT_ORIGIN = "http://127.0.0.1:5173";

describeWithDatabase("branded sign-up joins the client's organization", () => {
  let handles: AppHandles;
  let app: App;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-brand-"));
  const clientOrganizationId = `jrh-org-${stamp}`;
  const clientSpaceId = `jrh-space-${stamp}`;
  const staffEmail = `staff-${stamp}@rakazo.test`;
  const outsiderEmail = `outsider-${stamp}@rakazo.test`;
  let previousClaimant: { id: string; brandId: string | null } | null = null;

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      composio: new ComposioEmulator(),
    });
    app = handles.app;
    // brandId is unique: park any existing claimant for the duration of the test.
    previousClaimant = await handles.prisma.organization.findUnique({
      where: { brandId: "jrh" },
      select: { id: true, brandId: true },
    });
    if (previousClaimant) {
      await handles.prisma.organization.update({
        where: { id: previousClaimant.id },
        data: { brandId: null },
      });
    }
    await handles.prisma.organization.create({
      data: {
        id: clientOrganizationId,
        name: "Jackson Rental Homes",
        slug: clientOrganizationId,
        brandId: "jrh",
        createdAt: new Date(),
      },
    });
    await handles.prisma.space.create({
      data: {
        id: clientSpaceId,
        organizationId: clientOrganizationId,
        name: "Jackson Rental Homes",
        isDefault: true,
      },
    });
  });

  afterAll(async () => {
    if (handles) {
      const users = await handles.prisma.user.findMany({
        where: { email: { in: [staffEmail, outsiderEmail] } },
        select: { id: true, members: { select: { organizationId: true } } },
      });
      const personalOrganizationIds = users
        .flatMap((user) => user.members.map((member) => member.organizationId))
        .filter((id) => id !== clientOrganizationId);
      await handles.prisma.organization.deleteMany({
        where: { id: { in: [clientOrganizationId, ...personalOrganizationIds] } },
      });
      await handles.prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
      if (previousClaimant) {
        await handles.prisma.organization.update({
          where: { id: previousClaimant.id },
          data: { brandId: previousClaimant.brandId },
        });
      }
      await handles.stop();
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("makes a sign-up on the branded host a member of the client's default space", async () => {
    const cookie = await signup(app, staffEmail, "Staff Member", BRAND_ORIGIN);
    const user = await handles.prisma.user.findUniqueOrThrow({
      where: { email: staffEmail },
      include: { members: true },
    });
    expect(user.members).toEqual([
      expect.objectContaining({ organizationId: clientOrganizationId, role: "member" }),
    ]);

    const navigation = await rpc<SpaceNavigation>(app, cookie, "spaces/list", {}, BRAND_ORIGIN);
    expect(navigation.current.id).toBe(clientSpaceId);
    expect(navigation.spaces).toEqual([
      expect.objectContaining({
        id: clientSpaceId,
        name: "Jackson Rental Homes",
        isDefault: true,
        organizationId: clientOrganizationId,
        organizationName: "Jackson Rental Homes",
      }),
    ]);
  });

  it("still gives a default-brand sign-up its own personal organization", async () => {
    const cookie = await signup(app, outsiderEmail, "Outsider", DEFAULT_ORIGIN);
    const navigation = await rpc<SpaceNavigation>(app, cookie, "spaces/list");
    expect(navigation.spaces).toHaveLength(1);
    const [personal] = navigation.spaces;
    expect(personal).toMatchObject({ name: "Personal", isDefault: true });
    expect(personal!.organizationId).not.toBe(clientOrganizationId);
    expect(personal!.organizationName).toBe("Personal");
  });

  it("lists every space across organizations for a member of two", async () => {
    const outsider = await handles.prisma.user.findUniqueOrThrow({
      where: { email: outsiderEmail },
      include: { members: true },
    });
    const personalOrganizationId = outsider.members[0]!.organizationId;
    await handles.prisma.member.create({
      data: {
        id: `member-${stamp}`,
        organizationId: clientOrganizationId,
        userId: outsider.id,
        role: "member",
        createdAt: new Date(),
      },
    });
    // The default-space membership trigger adds the new member to the client's default space.
    await expect(
      handles.prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: clientSpaceId, userId: outsider.id } },
      }),
    ).resolves.toBeTruthy();

    const cookie = await signin(app, outsiderEmail);
    const navigation = await rpc<SpaceNavigation>(app, cookie, "spaces/list");
    expect(
      navigation.spaces.map((space) => [space.organizationId, space.organizationName]),
    ).toEqual([
      [personalOrganizationId, "Personal"],
      [clientOrganizationId, "Jackson Rental Homes"],
    ]);
    // The current space is still the one the session resolved (the personal default).
    expect(navigation.current.id).toBe(personalOrganizationId);

    // Switching to the other organization's space works through the same header as today.
    const switched = await rpc<SpaceNavigation>(app, cookie, "spaces/list", {}, DEFAULT_ORIGIN, {
      "x-rakazo-space-id": clientSpaceId,
    });
    expect(switched.current.id).toBe(clientSpaceId);
    expect(switched.spaces).toHaveLength(2);
  });
});

async function signup(app: App, email: string, name: string, origin: string) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password: "test-password-123", name }),
  });
  expect(response.status).toBeLessThan(400);
  return sessionCookieHeader(response);
}

async function signin(app: App, email: string) {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: DEFAULT_ORIGIN },
    body: JSON.stringify({ email, password: "test-password-123" }),
  });
  expect(response.status).toBeLessThan(400);
  return sessionCookieHeader(response);
}

async function rpc<T>(
  app: App,
  cookie: string,
  proc: string,
  body: unknown = {},
  origin: string = DEFAULT_ORIGIN,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await app.request(`/rpc/${proc}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin, ...extraHeaders },
    body: JSON.stringify({ json: body }),
  });
  const text = await res.text();
  const parsed = JSON.parse(text) as { json?: T; error?: { message?: string } };
  if (res.status >= 400 || parsed.error) {
    throw new Error(`${proc} ${res.status}: ${parsed.error?.message ?? text}`);
  }
  return parsed.json as T;
}
