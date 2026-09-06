import { expect, test } from "@playwright/test";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("the sidebar shows the organization and space creation requires approval", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `spaces-${stamp}@rakazo.test`, "password12", "Space Owner");
  await completeOnboarding(page);

  const sidebar = page.locator("aside").first();
  await expect(sidebar.getByText("Personal", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Chief/ })).toHaveCount(1);
  await captureScreenshot(page, testInfo, "single-space-sidebar");

  await page.getByTitle("Create", { exact: true }).click();
  await page.getByRole("button", { name: "New space" }).click();
  const dialog = page.getByRole("dialog", { name: "New space" });
  await expect(dialog.getByLabel("Name")).toBeVisible();
  await dialog.getByLabel("Name").fill("Customer support");
  await captureScreenshot(page, testInfo, "new-space-dialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const composer = page.getByRole("combobox", { name: "Message Chief" });
  await composer.fill("Create a space named Customer support");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Create space", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Always allow this tool" })).toHaveCount(0);
  await expect(sidebar.getByText("Customer support", { exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "create-space-chat-approval");
  await page.getByRole("button", { name: "Create space", exact: true }).click();
  await expect(page.getByText("Created", { exact: true })).toBeVisible();

  await expect(sidebar.getByText("Personal", { exact: true }).first()).toBeVisible();
  await expect(sidebar.getByText("Customer support", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const supportSpace = sidebar
    .locator('[data-sidebar-group^="space:"]')
    .filter({ hasText: "Customer support" });
  const supportSpaceGroup = await supportSpace.getAttribute("data-sidebar-group");
  const supportSpaceId = supportSpaceGroup?.split(":")[1];
  expect(supportSpaceId).toBeTruthy();
  // A configured model is already available to this space: setup must honor me.needsModel.
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.json.needsModel = false;
    await route.fulfill({ response, json: payload });
  });
  await supportSpace.getByRole("button", { name: "Open Customer support" }).click();
  await page.waitForURL(/\/onboarding/);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("rakazo:space-id")))
    .toBe(supportSpaceId);
  await expect(page.getByRole("heading", { name: "Create your first bot" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect a model" })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "space-setup-existing-model");
  await completeOnboarding(page);

  await expect(sidebar.getByText("Personal", { exact: true }).first()).toBeVisible();
  await expect(sidebar.getByText("Customer support", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Chief/ })).toHaveCount(2);
  await captureScreenshot(page, testInfo, "spaces-sidebar");

  const personalSpace = sidebar
    .locator('[data-sidebar-group^="space:"]')
    .filter({ hasText: "Personal" });
  const personalSpaceGroup = await personalSpace.getAttribute("data-sidebar-group");
  const personalSpaceId = personalSpaceGroup?.split(":")[1];
  expect(personalSpaceId).toBeTruthy();
  await personalSpace.getByRole("button", { name: /^Chief/ }).click();
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("rakazo:space-id")))
    .toBe(personalSpaceId);
  await expect(sidebar.getByText("Customer support", { exact: true })).toBeVisible();
});

test("Manor hides other organizations and recovers a saved client space", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const email = `portal-sidebar-${stamp}@rakazo.test`;
  await signup(page, email, "password12", "Portal Owner");
  await completeOnboarding(page);
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  const clientId = `portal-client-${stamp}`;
  try {
    const member = await prisma.member.findFirstOrThrow({ where: { user: { email } } });
    await prisma.organization.update({
      where: { id: member.organizationId },
      data: { name: "Studio" },
    });
    await prisma.organization.create({
      data: { id: clientId, name: "Client Company", slug: clientId, createdAt: new Date() },
    });
    await prisma.member.create({
      data: {
        id: `${clientId}-member`,
        organizationId: clientId,
        userId: member.userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.space.create({
      data: { id: clientId, organizationId: clientId, name: "Client space" },
    });
    await prisma.spaceMember.create({
      data: {
        id: `${clientId}-space-member`,
        organizationId: clientId,
        spaceId: clientId,
        userId: member.userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.bot.create({
      data: {
        spaceId: clientId,
        userId: member.userId,
        name: "Client assistant",
        color: "#a855f7",
        thread: { create: { spaceId: clientId, userId: member.userId } },
      },
    });
    await page.reload();
    const sidebar = page.locator("aside").first();
    await expect(sidebar.getByText("Studio", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Client Company", { exact: true })).toHaveCount(0);
    await expect(sidebar.getByText("Client assistant", { exact: true })).toHaveCount(0);
    await captureScreenshot(page, testInfo, "organization-scoped-sidebar");

    await page.evaluate((id) => localStorage.setItem("rakazo:space-id", id), clientId);
    await page.goto("/app");
    await expect(sidebar.getByRole("button", { name: /^Chief/ })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("rakazo:space-id")))
      .toBe(member.organizationId);
    await expect(sidebar.getByText("Client assistant", { exact: true })).toHaveCount(0);
    await captureScreenshot(page, testInfo, "recovered-main-organization");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
});
