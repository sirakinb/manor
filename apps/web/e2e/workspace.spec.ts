import { expect, test } from "@playwright/test";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * The Workspace place only exists for organizations with a connected
 * warehouse. The harness hands the API and this spec the same Postgres, so the
 * spec seeds a workspace straight into it once the account exists.
 */
test("workspace appears once the organization has one and its map opens sections", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const email = `workspace-${stamp}@rakazo.test`;
  await signup(page, email, "password12", "Jackson Tester");
  await completeOnboarding(page);

  const sidebar = page.locator("aside").first();
  await expect(sidebar.getByRole("button", { name: "CRM" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Workspace", exact: true })).toHaveCount(0);

  await page.goto("/app/workspace");
  await expect(page.getByText("No workspace is connected to this account.")).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-empty");

  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "the harness exports DATABASE_URL").toBeTruthy();
  const { prisma, pool } = createDb(databaseUrl!);
  try {
    const member = await prisma.member.findFirstOrThrow({
      where: { user: { email } },
      select: { organizationId: true },
    });
    const workspace = await prisma.workspace.create({
      data: {
        organizationId: member.organizationId,
        name: "Harbor Homes",
        slug: `harbor-homes-${stamp}`,
        channels: ["voice"],
        sources: {
          create: {
            name: "Retell",
            sourceType: "voice",
            status: "connected",
            lastSyncedAt: new Date(),
          },
        },
      },
    });
    const hourAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    await prisma.workspaceVoiceCall.createMany({
      data: [
        {
          workspaceId: workspace.id,
          sourceCallId: `call-${stamp}-1`,
          agentType: "tenant",
          callerName: "Dana Reyes",
          callerPhone: "+1 555 0100",
          callStartedAt: hourAgo(2),
          durationSeconds: 240,
          aiResolved: true,
          callbackRequested: false,
        },
        {
          workspaceId: workspace.id,
          sourceCallId: `call-${stamp}-2`,
          agentType: "tenant",
          callerName: "Sam Okafor",
          callerPhone: "+1 555 0101",
          callStartedAt: hourAgo(26),
          durationSeconds: 90,
          aiResolved: false,
          callbackRequested: true,
        },
        {
          workspaceId: workspace.id,
          sourceCallId: `call-${stamp}-3`,
          agentType: "landlord",
          callerName: "Priya Nair",
          callerPhone: "+1 555 0102",
          callStartedAt: hourAgo(50),
          durationSeconds: 400,
          aiResolved: true,
          callbackRequested: false,
        },
      ],
    });
    await prisma.workspaceActivity.create({
      data: {
        workspaceId: workspace.id,
        channel: "voice",
        kind: "callback",
        title: "Scheduled a callback for Sam Okafor",
        actor: "voice-agent",
        verification: "auto",
      },
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }

  // The shell reads workspace status once on mount, so a reload picks it up.
  await page.goto("/app");
  await expect(sidebar.getByRole("button", { name: "Workspace", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.waitForURL(/\/app\/workspace$/);

  const map = page.getByTestId("workspace-map");
  await expect(map).toBeVisible();
  await expect(map.locator('[data-node="vault"]')).toBeVisible();
  await expect(map.locator('[data-node="channel:voice"]')).toBeVisible();
  await expect(map.locator('[data-node="source:Retell"]')).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-map");

  const rail = page.getByRole("navigation", { name: "Workspace sections" });
  await rail.getByRole("button", { name: "Voice" }).click();
  await page.waitForURL(/section=voice/);
  const panel = page.getByRole("dialog", { name: "Voice" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Dana Reyes")).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-voice-panel");

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Voice" })).toBeVisible();

  await page.getByRole("dialog", { name: "Voice" }).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Voice" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/section=/);

  await map.locator('[data-node="channel:voice"]').click();
  await expect(page.getByRole("dialog", { name: "Voice" })).toBeVisible();
});
