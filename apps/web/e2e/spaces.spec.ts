import { expect, test } from "@playwright/test";
import { createDb } from "@rakazo/db";
import { captureScreenshot, completeOnboarding, openNewSpace, rpc, signup } from "./helpers";

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

    // The saved client space is dropped and the page reloads into the account's own space with
    // nothing saved, as on a fresh sign-in.
    const savedSpace = () => page.evaluate(() => localStorage.getItem("rakazo:space-id"));
    await page.evaluate((id) => localStorage.setItem("rakazo:space-id", id), clientId);
    await page.goto("/app");
    await expect(sidebar.getByRole("button", { name: /^Chief/ })).toBeVisible();
    await expect.poll(savedSpace).toBeNull();
    await expect(sidebar.getByText("Client Company", { exact: true })).toHaveCount(0);
    await expect(sidebar.getByText("Client assistant", { exact: true })).toHaveCount(0);
    await captureScreenshot(page, testInfo, "recovered-main-organization");

    await page.reload();
    await expect(sidebar.getByRole("button", { name: /^Chief/ })).toBeVisible();
    expect(await savedSpace()).toBeNull();
    await expect(sidebar.getByText("Client Company", { exact: true })).toHaveCount(0);
    await expect(sidebar.getByText("Client assistant", { exact: true })).toHaveCount(0);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
});

test("a new space auto-completes onboarding, is renamed in its settings, and is deleted with its bots", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `spaces-delete-${stamp}@rakazo.test`, "password12", "Space Owner");
  await completeOnboarding(page);

  const sidebar = page.locator("aside").first();
  await openNewSpace(page);
  const dialog = page.getByRole("dialog", { name: "New space" });
  const name = dialog.getByLabel("Name");
  await name.fill("Typo space");
  const windowKeys = await page.evaluateHandle(() => {
    const keys: string[] = [];
    window.addEventListener("keydown", (event) => keys.push(event.key));
    return keys;
  });
  // These synthetic keyboard events exercise the browser event flags; they do not start an OS IME.
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    await name.dispatchEvent("keydown", { key: "Enter", ...composition });
    await name.dispatchEvent("keydown", { key: "Escape", ...composition });
    expect(await windowKeys.evaluate((keys) => keys.includes("Escape"))).toBe(false);
    await expect(dialog.getByRole("button", { name: "Create space", exact: true })).toBeEnabled();
  }
  await name.press("Enter");

  // Model is already connected, so onboarding skips the form and lands in Chief.
  await completeOnboarding(page);
  await expect(page).toHaveURL(/\/app\//);
  await expect(sidebar.getByText("Typo space", { exact: true })).toBeVisible();
  const occupied = sidebar
    .locator('[data-sidebar-group^="space:"]')
    .filter({ hasText: "Typo space" });
  await expect(occupied.getByRole("button", { name: /^Chief/ })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Chief/ })).toHaveCount(2);
  await captureScreenshot(page, testInfo, "new-space-after-onboarding");

  // The space menu's Settings opens the Space section, where it is renamed in place.
  await sidebar.getByRole("button", { name: "Actions for Typo space" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename space" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const settings = page.getByTestId("user-settings");
  await expect(settings).toHaveAttribute("data-settings-section", "space");
  const spaceName = settings.getByTestId("space-settings").getByLabel("Name");
  await expect(spaceName).toHaveValue("Typo space");
  await spaceName.fill("Temporary");
  await captureScreenshot(page, testInfo, "space-settings-rename");
  await spaceName.press("Enter");
  await expect(settings.getByRole("heading", { name: "Temporary" })).toBeVisible();
  await expect(sidebar.getByText("Temporary", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Typo space", { exact: true })).toHaveCount(0);

  // An occupied space is deleted with its bots after one confirmation naming them.
  await settings.getByRole("button", { name: "Delete space" }).click();
  const deleteSpaceDialog = page.getByRole("alertdialog", {
    name: "Delete Temporary and its 1 bot?",
  });
  await expect(deleteSpaceDialog).toBeVisible();
  await captureScreenshot(page, testInfo, "delete-space-dialog");
  await deleteSpaceDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(sidebar.getByText("Temporary", { exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/onboarding/);
  await expect(sidebar.getByRole("button", { name: /^Chief/ })).toHaveCount(1);
  await page.reload();
  await expect(sidebar.getByText("Temporary", { exact: true })).toHaveCount(0);

  // A stale onboarding URL recovers without duplicating the bot.
  await page.goto("/onboarding");
  await page.waitForURL(/\/app/);
  await expect(page).not.toHaveURL(/\/onboarding/);
  await expect(sidebar.getByRole("button", { name: /^Chief/ })).toHaveCount(1);
});

test("deleting the last bot in a space stays in the app after first use", {
  tag: "@nightly",
}, async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `spaces-empty-${stamp}@rakazo.test`, "password12", "Space Owner");
  await completeOnboarding(page);
  const [chief] = await rpc<Array<{ id: string }>>(page, "bots/list", {});
  expect(chief).toBeTruthy();
  await rpc(page, "bots/archive", { botId: chief!.id });
  await page.reload();
  await expect(page).not.toHaveURL(/\/onboarding/);

  const sidebar = page.locator("aside").first();
  await openNewSpace(page);
  const dialog = page.getByRole("dialog", { name: "New space" });
  await dialog.getByLabel("Name").fill("Side");
  await dialog.getByRole("button", { name: "Create space", exact: true }).click();
  await page.waitForURL(/\/(onboarding|app)/);
  await completeOnboarding(page);
  await expect(sidebar.getByText("Side", { exact: true })).toBeVisible();

  // Delete the only bot in the new space: the app must stay put instead of
  // forcing onboarding again.
  const sideBot = sidebar
    .locator('[data-sidebar-group^="space:"]')
    .filter({ hasText: "Side" })
    .getByRole("button", { name: /^Chief/ });
  await sideBot.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: /Delete Chief/ });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(sideBot).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/onboarding/);
  await page.reload();
  await expect(page).not.toHaveURL(/\/onboarding/);
  await expect(sidebar.getByRole("button", { name: "Open Side" })).toBeVisible();
  await expect(
    page.locator("main").getByRole("button", { name: "New bot", exact: true }),
  ).toBeVisible();

  await sidebar.getByRole("button", { name: "Actions for Side" }).click();
  await page.getByRole("menuitem", { name: "Delete space" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete Side?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(sidebar.getByText("Side", { exact: true })).toHaveCount(0);
  await sidebar.getByRole("button", { name: /^Archived/ }).click();
  await expect(sidebar.getByText("Chief", { exact: true })).toBeVisible();
});
