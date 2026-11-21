import { expect, type Page, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, createNamedBot, signup } from "./helpers";

async function captureSidebarSearchSelected(
  page: Page,
  testInfo: Parameters<typeof captureScreenshot>[1],
  name: string,
) {
  const aside = page.locator("aside").first();
  const search = aside.getByTestId("sidebar-search");
  const selected = aside.getByRole("button", { name: /^Chief/ }).first();
  await expect(search).toBeVisible();
  await expect(selected).toBeVisible();
  await search.scrollIntoViewIfNeeded();

  const searchBox = await search.boundingBox();
  const selectedBox = await selected.boundingBox();
  expect(searchBox).toBeTruthy();
  expect(selectedBox).toBeTruthy();
  if (searchBox && selectedBox) {
    expect(Math.abs(searchBox.x - selectedBox.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(searchBox.x + searchBox.width - (selectedBox.x + selectedBox.width)),
    ).toBeLessThanOrEqual(1);
  }

  const box = await aside.boundingBox();
  if (box) {
    const screenshotPath = testInfo.outputPath(`${name}.png`);
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      path: screenshotPath,
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.min(box.width + 24, 360),
        height: Math.min(Math.max(box.height * 0.45, 280), 420),
      },
    });
    await testInfo.attach(name, { contentType: "image/png", path: screenshotPath });
    return;
  }
  await captureScreenshot(page, testInfo, name);
}

test("the app stays dark whatever the system or a stored preference asks for", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("rakazo.uiAppearance", "light"));
  const stamp = Date.now();
  await signup(page, `ui-appearance-${stamp}@rakazo.test`, "password12", "Appearance QA");
  await completeOnboarding(page, testInfo);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Language", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Appearance", exact: true })).toHaveCount(0);
  await expect(settings.getByTestId("ui-appearance-select")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "ui-appearance-dark-settings");

  await settings.getByRole("button", { name: "Close user settings" }).click();
  await expect(settings).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await captureSidebarSearchSelected(page, testInfo, "sidebar-search-selected-dark");
});

// Manor tints each bot row with its own colour, so bot rows cannot share one tone with the
// navigation rows. What holds instead: bot rows show their tint on hover, and Manor's
// navigation rows (Integrations, CRM, Documentation) hover with one shared tone.
test("sidebar bot rows hover with their tint and navigation rows share one tone", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `ui-hover-${stamp}@rakazo.test`, "password12", "Hover QA");
  await completeOnboarding(page, testInfo);
  await createNamedBot(page, "Second Bot");

  const sidebar = page.locator("aside").first();
  const chief = sidebar.getByRole("button", { name: /^Chief/ }).first();
  await expect(chief).toBeVisible();
  const readChiefBg = () => chief.evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(readChiefBg).toBe("rgba(0, 0, 0, 0)");

  await chief.hover();
  await expect.poll(readChiefBg).not.toBe("rgba(0, 0, 0, 0)");
  await captureScreenshot(page, testInfo, "sidebar-row-hover");

  const navRow = (name: string) => sidebar.getByRole("button", { name, exact: true });
  const readBg = (name: string) =>
    navRow(name).evaluate((el) => getComputedStyle(el).backgroundColor);
  await navRow("Integrations").hover();
  await expect.poll(() => readBg("Integrations")).not.toBe("rgba(0, 0, 0, 0)");
  const navBg = await readBg("Integrations");
  for (const name of ["CRM", "Documentation"]) {
    await expect.poll(() => readBg(name)).toBe("rgba(0, 0, 0, 0)");
    await navRow(name).hover();
    await expect.poll(() => readBg(name)).toBe(navBg);
  }
});
