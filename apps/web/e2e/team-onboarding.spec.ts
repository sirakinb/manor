import { expect, test } from "@playwright/test";
import { provisionPortalTeam } from "../../../packages/auth/src/provision-team";
import { createDb } from "../../../packages/db/src/index";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

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
    await signup(page, ownerEmail, "password12", "Alex");
    await page.waitForURL(/\/(onboarding|app)/);
    await signup(peerPage, peerEmail, "password12", "Blair");
    await peerPage.waitForURL(/\/(onboarding|app)/);
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
    await page.evaluate((id) => localStorage.setItem("rakazo:space-id", id), team.spaceId);
    await page.goto("/onboarding");
    await expect(page.getByText("Example Team", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Agents, conversations, files, and connected accounts are shared."),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, "team-setup-sharing-boundary");
    await completeOnboarding(page);
    await expect(page.getByText(/Welcome to Example Team/)).toBeVisible();
    await page.getByRole("button", { name: /Day-to-day work/ }).click();
    await expect(
      page.getByText(/Accounts connected here can be used by everyone on your team/),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, "shared-account-onboarding");
    const sharedBotUrl = page.url();
    await peerPage.evaluate((id) => localStorage.setItem("rakazo:space-id", id), team.spaceId);
    await peerPage.goto("/onboarding");
    await expect(peerPage).toHaveURL(sharedBotUrl);
    await expect(peerPage.getByRole("combobox", { name: "Message Chief" })).toBeVisible();
    expect(await db.prisma.bot.count({ where: { spaceId: team.spaceId } })).toBe(1);
    expect(await db.prisma.space.count({ where: { organizationId } })).toBe(1);
  } finally {
    await peerContext.close();
    if (organizationId) await db.prisma.organization.delete({ where: { id: organizationId } });
    if (accountUserId) await db.prisma.user.delete({ where: { id: accountUserId } });
    await db.prisma.$disconnect();
    await db.pool.end();
  }
});
