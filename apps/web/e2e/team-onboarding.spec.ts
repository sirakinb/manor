import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { brandById } from "@rakazo/brands";
import { createDb } from "@rakazo/db";
import { provisionPortalTeam } from "../../../packages/auth/src/provision-team";
import { captureScreenshot, completeOnboarding, signup } from "./helpers/helpers";

// Both tests claim the "vibecodephilly" brand, and an organization's brand id is unique.
// They share this file so they run one after the other: spec files run in parallel workers,
// and side by side each test would find, rebrand or delete the other's organization.

test("new organization starts with one shared space and teammates reuse its setup", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = Date.now();
  const ownerEmail = `team-owner-${stamp}@example.test`;
  const peerEmail = `team-peer-${stamp}@example.test`;
  const peerContext = await browser.newContext();
  const peerPage = await peerContext.newPage();
  const db = createDb(process.env.DATABASE_URL!);
  let organizationId: string | undefined;
  let accountUserId: string | null = null;
  try {
    // Let each signup finish its own first-run setup in its personal space before the team
    // exists. Left running, that setup can land its first bot in the shared space once the
    // personal organizations are deleted, and the shared setup below would never be shown.
    await signup(page, ownerEmail, "password12", "Alex");
    await completeOnboarding(page);
    await signup(peerPage, peerEmail, "password12", "Blair");
    await completeOnboarding(peerPage);
    // Park both pages so a running shell cannot react to its space disappearing.
    await page.goto("about:blank");
    await peerPage.goto("about:blank");
    const team = await provisionPortalTeam(db.prisma, {
      brandId: "vibecodephilly",
      members: [
        { email: ownerEmail, name: "Alex" },
        { email: peerEmail, name: "Blair" },
      ],
    });
    organizationId = team.organizationId;
    // Serve the synthetic organization on the harness's localhost portal.
    // Branded-host authorization is covered by the API signup tests.
    await db.prisma.organization.update({ where: { id: organizationId }, data: { brandId: null } });
    const originalMemberships = await db.prisma.member.findMany({
      where: {
        user: { email: { in: [ownerEmail, peerEmail] } },
        organizationId: { not: organizationId },
      },
      select: { organizationId: true },
    });
    await db.prisma.organization.deleteMany({
      where: { id: { in: originalMemberships.map((member) => member.organizationId) } },
    });
    // Synthetic display name keeps the screenshot independent of client branding.
    const space = await db.prisma.space.update({
      where: { id: team.spaceId },
      data: { name: "Example Team" },
    });
    accountUserId = space.accountUserId;
    expect(accountUserId).toBeTruthy();
    expect(await db.prisma.space.count({ where: { organizationId } })).toBe(1);
    expect(await db.prisma.bot.count({ where: { spaceId: team.spaceId } })).toBe(0);
    await page.addInitScript((id) => localStorage.setItem("rakazo:space-id", id), team.spaceId);
    // Setup asks the server for the Space's first bot and opens its chat on its own. Hold that
    // request so the sharing notice is on screen for as long as the assertions need it.
    let releaseBotCreate: () => void = () => undefined;
    const botCreateHeld = new Promise<void>((resolve) => {
      releaseBotCreate = resolve;
    });
    const firstBotRequest = /^https?:\/\/[^/]+\/rpc\/onboarding\/firstBot(?:\?|$)/;
    await page.route(firstBotRequest, async (route) => {
      await botCreateHeld;
      await route.continue();
    });
    await page.goto("/onboarding");
    await expect(page.getByText("Example Team", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Agents, conversations, files, and connected accounts are shared."),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, "team-setup-sharing-boundary");
    releaseBotCreate();
    await completeOnboarding(page);
    await page.unroute(firstBotRequest);
    await page.waitForURL(/\/app\/[^/]+$/);
    expect(await db.prisma.bot.count({ where: { spaceId: team.spaceId } })).toBe(1);
    // The sidebar row previews the latest message too, so read the chat itself.
    const transcript = page.getByTestId("transcript");
    await expect(transcript.getByText(/Welcome to Example Team/)).toBeVisible();
    await page.getByRole("button", { name: /Day-to-day work/ }).click();
    await expect(
      transcript.getByText(/Accounts connected here can be used by everyone on your team/),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, "shared-account-onboarding");
    const sharedBotUrl = page.url();
    await peerPage.addInitScript((id) => localStorage.setItem("rakazo:space-id", id), team.spaceId);
    await peerPage.goto("/onboarding");
    await expect(peerPage).toHaveURL(sharedBotUrl);
    await expect(peerPage.getByRole("combobox", { name: "Message Chief" })).toBeVisible();
    expect(await db.prisma.bot.count({ where: { spaceId: team.spaceId } })).toBe(1);
    expect(await db.prisma.space.count({ where: { organizationId } })).toBe(1);
  } finally {
    await peerContext.close();
    if (organizationId) await db.prisma.organization.delete({ where: { id: organizationId } });
    if (accountUserId) await db.prisma.user.delete({ where: { id: accountUserId } });
    await db.prisma.user.deleteMany({ where: { email: { in: [ownerEmail, peerEmail] } } });
    await db.prisma.$disconnect();
    await db.pool.end();
  }
});

test("branded team shows active and last-seen members without exposing other organizations", async ({
  page,
}, testInfo) => {
  const email = `team-${randomUUID()}@rakazo.test`;
  await signup(page, email, "password12", "Team Tester");
  await completeOnboarding(page);
  const signupCookies = await page.context().cookies();
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  const teammateId = randomUUID();
  let organizationId: string | undefined;
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const membership = await prisma.member.findFirstOrThrow({ where: { userId: user.id } });
    organizationId = membership.organizationId;
    await prisma.organization.update({
      where: { id: organizationId },
      data: { brandId: "vibecodephilly", name: "Vibe Code Philly" },
    });
    await prisma.user.create({
      data: {
        id: teammateId,
        email: `teammate-${teammateId}@rakazo.test`,
        name: "Team Colleague",
        lastSignedInAt: new Date("2026-09-01T12:00:00Z"),
      },
    });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: teammateId,
        role: "member",
        createdAt: new Date(),
        lastActiveAt: new Date("2026-09-02T12:00:00Z"),
      },
    });
    // Anchored at the origin: a source module's path can hold "/rpc/" too.
    await page.route(/^https?:\/\/[^/]+\/(?:api\/auth|rpc)\//, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const response = await route.fetch({
        url: new URL(`${url.pathname}${url.search}`, process.env.API_URL!).toString(),
        headers: { ...request.headers(), host: brandById("vibecodephilly")!.hostnames[0]! },
      });
      await route.fulfill({ response });
    });
    await page.goto("/app?__brand=vibecodephilly");
    // Fail here, not at the test timeout, when the branded shell does not load.
    await expect(page.getByTestId("user-menu-trigger")).toBeVisible();
    await page.getByTestId("user-menu-trigger").click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const team = page.getByRole("region", { name: "Team", exact: true });
    await expect(team.getByTestId("team-member")).toHaveCount(2);
    await expect(team.getByText("Team Colleague", { exact: true })).toBeVisible();
    await expect(team.getByText("Last active", { exact: false })).toBeVisible();
    await expect(team.getByText("Last sign-in", { exact: false })).toHaveCount(2);
    await expect(team.getByText("Active now", { exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-brand", "vibecodephilly");
    await team.scrollIntoViewIfNeeded();
    await captureScreenshot(page, testInfo, "vibecodephilly-team-presence");
    await page.context().clearCookies();
    await page.goto("/sign-in?__brand=vibecodephilly");
    await expect(page.getByRole("img", { name: "Vibe Code Philly" })).toBeVisible();
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      "/brands/vibecodephilly/favicon.png",
    );
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in to Vibe Code Philly" })).toHaveClass(
      "sr-only",
    );
    await captureScreenshot(page, testInfo, "vibecodephilly-sign-in");
  } finally {
    try {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      if (organizationId)
        await prisma.organization.update({
          where: { id: organizationId },
          data: { brandId: null },
        });
      await prisma.user.deleteMany({ where: { id: teammateId } });
      await page.context().addCookies(signupCookies);
      const removed = await page.request.post("/api/auth/delete-user", {
        data: { password: "password12" },
        headers: { origin: new URL(page.url()).origin },
      });
      expect(removed.ok()).toBe(true);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      if (organizationId)
        expect(await prisma.organization.findUnique({ where: { id: organizationId } })).toBeNull();
    } finally {
      try {
        await prisma.$disconnect();
      } finally {
        await pool.end();
      }
    }
  }
});
