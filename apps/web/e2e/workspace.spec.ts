import { expect, test } from "@playwright/test";
import type { ModelCatalogEntry } from "@rakazo/contracts";
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
  const mcpBoundary = await page.request.post("/mcp/workspace", { data: {} });
  expect(mcpBoundary.status()).toBe(401);
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
  let selectedBotId = "";
  try {
    const member = await prisma.member.findFirstOrThrow({
      where: { user: { email } },
      select: { organizationId: true, userId: true },
    });
    const membership = await prisma.spaceMember.findFirstOrThrow({ where: member });
    const selectedBot = await prisma.bot.create({
      data: {
        spaceId: membership.spaceId,
        userId: member.userId,
        name: "Operations",
        color: "#123456",
        thread: { create: { spaceId: membership.spaceId, userId: member.userId } },
      },
    });
    selectedBotId = selectedBot.id;
    const workspace = await prisma.workspace.create({
      data: {
        organizationId: member.organizationId,
        name: "Harbor Homes",
        slug: `harbor-homes-${stamp}`,
        channels: ["voice", "utilities", "email", "social"],
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
    await prisma.workspaceSource.create({
      data: { workspaceId: workspace.id, name: "Gmail", sourceType: "email", status: "connected" },
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
    await prisma.workspaceUtilityProperty.create({
      data: {
        workspaceId: workspace.id,
        address: "24 Meadow Lane",
        addressNorm: "24 meadow lane",
        billingMode: "blocked",
        notes: "Bills are sent to service address",
      },
    });
    await prisma.workspaceWaterBill.create({
      data: {
        workspaceId: workspace.id,
        utility: "water",
        gmailMessageId: `unmatched-${stamp}`,
        serviceAddress: "90 Sample Road",
        serviceAddressNorm: "90 sample road",
        accountBalance: 25,
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
    await prisma.workspaceSkill.create({
      data: {
        workspaceId: workspace.id,
        name: "callback-playbook",
        content: "# Callbacks\nCheck requested callbacks before scheduling follow-up.",
        createdBy: "import",
      },
    });
    await prisma.workspaceContext.create({
      data: {
        workspaceId: workspace.id,
        key: "office-hours",
        content: "Office hours are weekdays 9–5.",
        updatedBy: "import",
      },
    });
    await prisma.workspaceInstagramStats.create({
      data: {
        workspaceId: workspace.id,
        igUserId: "example-account",
        username: "harborhomes",
        followers: 1840,
        reach28d: 12500,
        mediaCount: 48,
        profileViews28d: 890,
        totalInteractions28d: 640,
      },
    });
    await prisma.workspaceInstagramDaily.createMany({
      data: Array.from({ length: 14 }, (_, index) => ({
        workspaceId: workspace.id,
        igUserId: "example-account",
        date: new Date(Date.now() - (13 - index) * 86400000),
        reach: 200 + (index % 5) * 120,
        followers: 1800 + index * 3,
        newFollowers: index === 4 ? null : index % 5,
      })),
    });
    await prisma.workspaceInstagramMedia.createMany({
      data: [
        "A first look at our new waterfront homes",
        "Three ways to make your next move easier",
        "Inside a bright, welcoming studio",
      ].map((caption, index) => ({
        workspaceId: workspace.id,
        igUserId: "example-account",
        mediaId: `example-post-${index}`,
        caption,
        postedAt: new Date(),
        reach: 1500 - index * 200,
        likeCount: 80 - index * 10,
        commentsCount: 12 - index,
      })),
    });
    await prisma.workspaceReport.create({
      data: {
        workspaceId: workspace.id,
        reportType: "email",
        title: "Weekly email recap · Sample",
        status: "draft",
        dateRangeStart: new Date("2026-08-24"),
        dateRangeEnd: new Date("2026-08-30"),
        generatedAt: new Date(),
        summary: "A concise review of two recent campaigns.",
        report: {
          agg: {
            campaigns: 2,
            delivered: 2400,
            openRate: 38,
            clicks: 160,
            ctor: 18,
            deliveredRate: 99,
          },
          synthesis: {
            summary: "Two campaigns reached the community.",
            what_worked: [
              {
                title: "Clear subject lines",
                detail: "The rental update led this week's results.",
              },
            ],
            what_underperformed: [],
            recommended_actions: [],
          },
        },
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
  await expect(map.getByText("PHL Water/Gmail", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Ask the team", exact: true })).toHaveCount(0);
  await tabs.getByRole("button", { name: "AI team", exact: true }).click();
  let sentMessages = 0;
  page.on("request", (request) => {
    if (/threads(?:\/|\.)send/.test(request.url())) sentMessages += 1;
  });
  await page
    .getByRole("listitem")
    .filter({ has: page.getByText("Operations", { exact: true }) })
    .getByRole("button", { name: "Chat", exact: true })
    .click();
  await page.waitForURL(`**/app/${selectedBotId}`);
  const draft = page.getByTestId("composer-bar").locator("textarea");
  await expect(draft).toHaveValue(/Review workspace operations in our workspace/);
  await draft.fill("My edited workspace question");
  await expect(draft).toHaveValue("My edited workspace question");
  expect(sentMessages).toBe(0);
  await captureScreenshot(page, testInfo, "workspace-bot-chat-draft");
  await sidebar.getByRole("button", { name: "Workspace", exact: true }).click();

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
  await expect(tabs.getByRole("button", { name: "Skills", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chat", exact: true }).first()).toBeVisible();
  const automations = page.getByTestId("workspace-automations");
  const voiceAutomation = automations.locator("li").filter({ hasText: "Voice calls" });
  await expect(voiceAutomation).toBeVisible();
  await expect(page.getByRole("heading", { name: "Platform syncs", exact: true })).toBeVisible();
  await expect(automations.getByText("Monthly recap", { exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "workspace-team");
  await page.getByRole("button", { name: "Knowledge", exact: true }).first().click();
  const knowledge = page.getByTestId("bot-knowledge");
  await knowledge.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(
    knowledge.getByText("workspace-callback-playbook", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("space-memory-list")
      .getByText(/office-hours/)
      .first(),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-native-knowledge");
  await voiceAutomation.getByRole("button", { name: "Run now" }).click();
  await expect(voiceAutomation.getByText("Queued", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-automations");

  // Utilities: the seeded charge can be skipped and restored.
  await tabs.getByRole("button", { name: "Utilities", exact: true }).click();
  await page.waitForURL(/\/app\/workspace\/utilities$/);
  await expect(page.getByRole("columnheader", { name: "Next step", exact: true })).toBeVisible();
  const manualProperty = page.getByRole("row").filter({ hasText: "24 Meadow Lane" });
  await expect(manualProperty.getByText("Manual handling", { exact: true })).toBeVisible();
  await expect(
    manualProperty.getByText("Bills are sent to service address", { exact: true }),
  ).toBeVisible();
  await expect(
    manualProperty.getByText("Handle manually using the billing instructions."),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-utilities-properties");
  const utilityViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("columnheader", { name: "Next step", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await captureScreenshot(page, testInfo, "workspace-utilities-properties-narrow");
  await page.setViewportSize(utilityViewport);
  await page.getByRole("button", { name: "Unmatched bills (1)", exact: true }).click();
  await expect(page.getByTestId("workspace-bill")).toHaveCount(1);
  await expect(page.getByTestId("workspace-bill")).toContainText("90 Sample Road");
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "12 Harbor Way" })
    .getByRole("button", { name: "Review bill", exact: true })
    .click();
  await expect(page.getByTestId("workspace-bill")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Post all pending/ })).toBeHidden();
  const bill = page.getByTestId("workspace-bill").filter({ hasText: "12 Harbor Way" });
  await expect(bill).toBeVisible();
  await expect(bill.getByRole("button", { name: "Post to Buildium" })).toBeHidden();
  await captureScreenshot(page, testInfo, "workspace-utilities-queue");
  await page.getByRole("textbox", { name: "Search properties or bills" }).fill("no-such-address");
  await expect(page.getByText("No bills match these filters")).toBeVisible();
  await page.getByRole("textbox", { name: "Search properties or bills" }).fill("");
  await bill.locator("summary").click();
  await expect(bill.getByRole("button", { name: "Post to Buildium" })).toBeVisible();
  await bill.getByRole("button", { name: "Skip" }).click();
  await expect(bill.getByText("Skipped", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-utilities-skipped");
  await bill.getByRole("button", { name: "Restore" }).click();
  await expect(bill.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect(bill.getByText("Skipped", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Property", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-utilities-properties");

  await tabs.getByRole("button", { name: "Social", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Instagram performance" })).toBeVisible();
  await expect(page.getByRole("img", { name: "New followers by day" })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-social");

  await tabs.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Scheduled reports" })).toBeVisible();
  await page
    .getByLabel("Client recipients", { exact: true })
    .fill("owner@example.test, ops@example.test");
  await page.getByLabel("Draft reviewer", { exact: true }).fill("reviewer@example.test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Client recipients", { exact: true })).toHaveValue(
    "owner@example.test, ops@example.test",
  );
  await captureScreenshot(page, testInfo, "workspace-reports");
  await page.getByText("Weekly email recap · Sample", { exact: true }).click();
  await page.getByRole("button", { name: "Test email", exact: true }).click();
  await expect(page.getByLabel("Test recipient", { exact: true })).toHaveValue(
    "reviewer@example.test",
  );
  await captureScreenshot(page, testInfo, "workspace-report-test-email");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const desktop = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/workspace/team");
  await expect(page.getByRole("heading", { name: "Your AI team" })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-team-narrow");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize(desktop);

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
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask the team", exact: true })).toHaveCount(0);
  const buildiumRow = page
    .locator("li")
    .filter({ has: page.getByText("Buildium", { exact: true }) });
  await buildiumRow.getByRole("button", { name: "Add", exact: true }).click();
  await buildiumRow.getByLabel("Label", { exact: true }).fill("Harbor ledger");
  await buildiumRow.getByLabel("clientId", { exact: true }).fill("synthetic-client");
  await buildiumRow.getByLabel("clientSecret", { exact: true }).fill("synthetic-secret");
  await buildiumRow.getByRole("button", { name: "Save", exact: true }).click();
  await expect(buildiumRow.getByText("Configured", { exact: true })).toBeVisible();
  await expect(buildiumRow.getByText("Buildium", { exact: true })).toHaveCount(1);
  await expect(buildiumRow.getByText("Harbor ledger", { exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "workspace-settings-connections");
  const openai = page.locator("li").filter({ has: page.getByText("OpenAI", { exact: true }) });
  await openai.getByRole("button", { name: "Add", exact: true }).click();
  await expect(openai.getByLabel("apiKey", { exact: true })).toBeVisible();
  await expect(openai.getByLabel("model", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-openai-credential");
  await openai.getByRole("button", { name: "Cancel", exact: true }).click();
  const instagram = page
    .locator("li")
    .filter({ has: page.getByText("Instagram", { exact: true }) });
  await instagram.getByRole("button", { name: "Add", exact: true }).click();
  await expect(instagram.getByLabel("pageToken", { exact: true })).toBeVisible();
  await expect(instagram.getByLabel("igUserId", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-settings");
  await sidebar.getByRole("button", { name: "Documentation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Getting started", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your first useful task" })).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-user-guide");
  await page.getByRole("button", { name: "Connect other agents", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy setup prompt", exact: true })).toHaveCSS(
    "background-color",
    "rgb(168, 85, 247)",
  );
  await captureScreenshot(page, testInfo, "workspace-documentation-purple");
  await page.getByText("Workspace tools and connection details", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bring context into another agent platform" }),
  ).toBeVisible();
  await expect(page.getByText("workspace_set_context", { exact: true }).first()).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-external-api-docs");
  await sidebar.getByRole("button", { name: "Integrations", exact: true }).click();
  const access = page.getByTestId("integrations-advanced");
  await expect(access).toBeVisible();
  expect(await access.evaluate((node) => node.parentElement?.firstElementChild === node)).toBe(
    true,
  );
  await access.locator("summary").click();
  await expect(access.getByRole("button", { name: "Create token", exact: true })).toHaveCSS(
    "background-color",
    "rgb(168, 85, 247)",
  );
  await captureScreenshot(page, testInfo, "workspace-integrations-access-purple");
  await page.getByRole("button", { name: "Close integrations" }).click();

  // The API separately verifies shared-credential authorization. Here the catalog
  // fixture checks that deployment availability reaches the bot model selector.
  await page.route("**/rpc/models/list", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as { json: ModelCatalogEntry[] };
    await route.fulfill({
      response,
      json: {
        ...payload,
        json: payload.json.map((entry) => ({
          ...entry,
          deploymentAvailable: entry.provider === "openrouter",
        })),
      },
    });
  });
  await page.goto(`/app/${selectedBotId}`);
  await page.locator("main").getByRole("button", { name: "Operations", exact: true }).click();
  const botSettings = page.getByTestId("bot-settings");
  await botSettings.getByText("Advanced", { exact: true }).click();
  const models = botSettings.getByRole("combobox", { name: "Model", exact: true });
  await expect(models.locator("option").filter({ hasText: "OpenRouter" }).first()).toBeAttached();
  expect(await models.locator("option").count()).toBeGreaterThan(2);
  await captureScreenshot(page, testInfo, "workspace-openrouter-model-choices");
});
