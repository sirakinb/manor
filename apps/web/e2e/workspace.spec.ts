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
        channels: ["voice", "utilities"],
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
    // One water-billed property with one active lease and one bill that resolves to it.
    const addressNorm = `12 harbor way ${stamp}`;
    await prisma.workspaceBuildiumProperty.create({
      data: {
        workspaceId: workspace.id,
        propertyId: 7101,
        addressLine: "12 Harbor Way",
        city: "Philadelphia",
      },
    });
    await prisma.workspaceBuildiumLease.create({
      data: {
        workspaceId: workspace.id,
        leaseId: 5101,
        propertyId: 7101,
        unitNumber: "A",
        status: "Active",
        rent: 1250,
        leaseTo: new Date("2027-06-30"),
      },
    });
    await prisma.workspaceUtilityProperty.create({
      data: {
        workspaceId: workspace.id,
        utility: "water",
        address: "12 Harbor Way",
        addressNorm,
        billingMode: "pass_through",
        propertyId: 7101,
        splitEvenly: false,
      },
    });
    await prisma.workspaceWaterBill.create({
      data: {
        workspaceId: workspace.id,
        utility: "water",
        gmailMessageId: `bill-${stamp}`,
        serviceAddress: "12 Harbor Way",
        serviceAddressNorm: addressNorm,
        accountBalance: 84.5,
        amountDue: 84.5,
        dueDate: new Date("2026-09-20"),
        billingMonth: new Date("2026-08-01"),
        parseStatus: "parsed",
      },
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
  await expect(sidebar.getByRole("button", { name: "Workspace" })).toBeVisible();
  await sidebar.getByRole("button", { name: "Workspace" }).click();
  await page.waitForURL(/\/app\/workspace$/);

  const stats = page.getByTestId("workspace-stats");
  await expect(stats).toBeVisible();
  await expect(stats.getByText("Calls · 30d")).toBeVisible();
  const map = page.getByTestId("workspace-map");
  await expect(map).toBeVisible();
  await expect(map.locator('[data-node="vault"]')).toBeVisible();
  await expect(map.locator('[data-node="channel:voice"]')).toBeVisible();
  await expect(map.locator('[data-node="source:Retell"]')).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-overview");

  const tabs = page.getByTestId("workspace-tabs");
  await tabs.getByRole("button", { name: "Voice", exact: true }).click();
  await page.waitForURL(/\/app\/workspace\/voice$/);
  await expect(page.getByRole("heading", { name: "Voice", exact: true })).toBeVisible();
  await expect(page.getByText("Dana Reyes")).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-voice");

  await page.getByText("Dana Reyes").click();
  await page.waitForURL(/\/app\/workspace\/voice\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Dana Reyes" })).toBeVisible();

  await tabs.getByRole("button", { name: "Overview", exact: true }).click();
  await page.waitForURL(/\/app\/workspace$/);
  await map.locator('[data-node="vault"]').click();
  await page.waitForURL(/\/app\/workspace\/system$/);
  await expect(page.getByRole("heading", { name: "System", exact: true })).toBeVisible();
  await expect(page.getByText("Freshness signal").first()).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-system");

  // AI team: the default automations list with a Run now that queues.
  await tabs.getByRole("button", { name: "AI team", exact: true }).click();
  await page.waitForURL(/\/app\/workspace\/team$/);
  const automations = page.getByTestId("workspace-automations");
  await expect(automations).toBeVisible();
  const voiceAutomation = automations.locator("li").filter({ hasText: "Voice calls" });
  await expect(voiceAutomation).toBeVisible();
  await voiceAutomation.getByRole("button", { name: "Run now" }).click();
  await expect(voiceAutomation.getByText("Queued", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-automations");

  // Utilities: the seeded charge can be skipped and restored.
  await tabs.getByRole("button", { name: "Utilities", exact: true }).click();
  await page.waitForURL(/\/app\/workspace\/utilities$/);
  const bill = page.getByTestId("workspace-bill").filter({ hasText: "12 Harbor Way" });
  await expect(bill).toBeVisible();
  await expect(bill.getByRole("button", { name: "Post to Buildium" })).toBeVisible();
  await bill.getByRole("button", { name: "Skip" }).click();
  await expect(bill.getByText("Skipped", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-utilities-skipped");
  await bill.getByRole("button", { name: "Restore" }).click();
  await expect(bill.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect(bill.getByText("Skipped", { exact: true })).toHaveCount(0);

  // Settings: the water GL account persists across a reload.
  await page.getByRole("button", { name: "Workspace settings" }).click();
  await page.waitForURL(/\/app\/workspace\/settings$/);
  const glAccount = page.getByLabel("Water GL account");
  await glAccount.fill("4321");
  // The nearest ancestor that carries a Save button is the Utilities card.
  const utilitiesCard = glAccount.locator(
    "xpath=ancestor::div[.//button[normalize-space()='Save']][1]",
  );
  await utilitiesCard.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Water GL account")).toHaveValue("4321");
  await captureScreenshot(page, testInfo, "workspace-settings");
});
