import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Bot } from "@rakazo/contracts";
import { createDb, createSpaceForMember, ensureOwnSpace, runAsSystem } from "@rakazo/db";
import {
  captureScreenshot,
  chooseOption,
  completeOnboarding,
  openNewSpace,
  signup,
} from "./helpers";

test("two teammates use the same agent and conversation while personal spaces stay private", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = randomUUID();
  const ownerEmail = `shared-owner-${stamp}@example.test`;
  const peerEmail = `shared-peer-${stamp}@example.test`;
  await signup(page, ownerEmail, "password12", "Alex");
  await completeOnboarding(page);
  const peerContext = await browser.newContext();
  const peerPage = await peerContext.newPage();
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  try {
    await signup(peerPage, peerEmail, "password12", "Blair");
    await peerPage.waitForURL(/\/(onboarding|app)/);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const peer = await prisma.user.findUniqueOrThrow({ where: { email: peerEmail } });
    const ownerMember = await prisma.member.findFirstOrThrow({ where: { userId: owner.id } });
    const peerMember = await prisma.member.findFirstOrThrow({ where: { userId: peer.id } });
    await prisma.organization.delete({ where: { id: peerMember.organizationId } });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: ownerMember.organizationId,
        userId: peer.id,
        role: "member",
        createdAt: new Date(),
      },
    });
    // A space that is not a team space holds one person, so joining the organization gives Blair
    // a space of their own there (as sign-in does), not a seat in Alex's default space.
    const peerOwnSpaceId = await runAsSystem("give a new organization member their own Space", () =>
      ensureOwnSpace(prisma, { id: peer.id }, ownerMember.organizationId),
    );
    // Same context the API uses when a member creates a Space, acting in Blair's own space.
    const personal = await runAsSystem("create a Space for its member", () =>
      createSpaceForMember(prisma, {
        currentSpaceId: peerOwnSpaceId,
        userId: peer.id,
        name: "Blair personal",
      }),
    );
    // Blair's browser still holds their deleted organization's space; start from their own one.
    await peerPage.evaluate(
      (spaceId) => localStorage.setItem("rakazo:space-id", spaceId),
      peerOwnSpaceId,
    );

    await openNewSpace(page);
    const dialog = page.getByRole("dialog", { name: "New space" });
    await dialog.getByLabel("Name", { exact: true }).fill("Team projects");
    await chooseOption(dialog.getByLabel("Space access"), "Team — everyone in this organization");
    await expect(
      dialog.getByText("Agents, conversations, files, and connected accounts are shared."),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, "create-shared-space");
    await dialog.getByRole("button", { name: "Create space", exact: true }).click();
    await page.waitForURL(/\/onboarding/);
    await completeOnboarding(page);
    const team = await prisma.space.findFirstOrThrow({
      where: {
        organizationId: ownerMember.organizationId,
        name: "Team projects",
        accountUserId: { not: null },
      },
    });
    const bot = await prisma.bot.findFirstOrThrow({
      where: { spaceId: team.id },
      select: { id: true },
    });
    const renamed = await page.request.post("/rpc/bots/update", {
      headers: { "x-rakazo-space-id": team.id },
      data: { json: { botId: bot.id, name: "Event agent" } },
    });
    expect(renamed.ok()).toBe(true);
    await page.reload();
    await peerPage.evaluate((spaceId) => localStorage.setItem("rakazo:space-id", spaceId), team.id);
    await peerPage.goto(`/app/${bot.id}`);
    await expect(peerPage.getByRole("combobox", { name: "Message Event agent" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Message Event agent" })).toBeVisible();
    const ownerSidebar = page.locator("aside").first();
    const peerSidebar = peerPage.locator("aside").first();
    await expect(ownerSidebar.getByText("Blair personal", { exact: true })).toHaveCount(0);
    await expect(peerSidebar.getByText("Blair personal", { exact: true })).toBeVisible();
    // Only the team space's headers carry the shared marker; Blair's own spaces do not.
    const teamMarker = { name: "Shared team space" } as const;
    await expect(
      peerSidebar
        .locator("[data-sidebar-group]")
        .filter({ hasText: "Team projects" })
        .getByRole("img", teamMarker)
        .first(),
    ).toBeVisible();
    await expect(
      peerSidebar
        .locator("[data-sidebar-group]")
        .filter({ hasText: "Blair personal" })
        .getByRole("img", teamMarker),
    ).toHaveCount(0);

    const ownerComposer = page.getByRole("combobox", { name: "Message Event agent" });
    await ownerComposer.fill("Let's plan the venue.");
    await ownerComposer.press("Enter");
    await expect(
      peerPage.locator("[data-message-id]").getByText("Let's plan the venue.", { exact: true }),
    ).toBeVisible();
    await expect(
      peerPage.locator("[data-message-id]").getByText("Alex", { exact: true }),
    ).toBeVisible();
    // The scripted test runtime does not consume in-flight steering; concurrency is
    // exercised separately by the API integration suite.
    await expect
      .poll(() =>
        prisma.run.count({
          where: { spaceId: team.id, status: { in: ["queued", "leased", "running"] } },
        }),
      )
      .toBe(0);
    const peerComposer = peerPage.getByRole("combobox", { name: "Message Event agent" });
    await peerComposer.fill("I'll prepare the invitations.");
    await peerComposer.press("Enter");
    await expect(
      page.locator("[data-message-id]").getByText("I'll prepare the invitations.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("[data-message-id]").getByText("Blair", { exact: true }),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, "shared-agent-owner-view");
    await captureScreenshot(peerPage, testInfo, "shared-agent-teammate-view");
    await peerPage.getByRole("button", { name: "Integrations", exact: true }).click();
    // The space name and its access sit side by side, without a separator.
    await expect(peerPage.getByTestId("integrations-space")).toHaveText(
      "Team projectsShared with your team",
    );
    // The featured tiles and the full catalog both list Gmail; a connected tile reads "Added".
    const gmailRow = peerPage
      .getByTestId("featured-connectors")
      .getByText("Gmail", { exact: true })
      .locator("xpath=ancestor::*[.//button][1]");
    await gmailRow.getByRole("button", { name: "Add", exact: true }).click();
    await expect(gmailRow.getByRole("button", { name: "Added", exact: true })).toBeVisible();
    await captureScreenshot(peerPage, testInfo, "shared-space-integrations");
    await page.getByRole("button", { name: "Integrations", exact: true }).click();
    const ownerGmail = page
      .getByTestId("featured-connectors")
      .getByText("Gmail", { exact: true })
      .locator("xpath=ancestor::*[.//button][1]");
    await expect(ownerGmail.getByRole("button", { name: "Added", exact: true })).toBeVisible();

    const denied = await page.request.post("/rpc/bots/list", {
      headers: { "x-rakazo-space-id": personal.id },
      data: { json: {} },
    });
    expect(denied.status()).toBeGreaterThanOrEqual(400);
    const sameBots = await peerPage.request.post("/rpc/bots/list", {
      headers: { "x-rakazo-space-id": team.id },
      data: { json: {} },
    });
    expect(((await sameBots.json()).json as Bot[]).map((b) => b.id)).toEqual([bot.id]);
    await expect
      .poll(
        () =>
          prisma.run.count({
            where: { spaceId: team.id, status: { in: ["queued", "leased", "running"] } },
          }),
        { timeout: 30_000 },
      )
      .toBe(0);
  } finally {
    await peerContext.close();
    await prisma.$disconnect();
    await pool.end();
  }
});
