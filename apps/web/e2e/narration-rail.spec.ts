import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

// The bot's reasoning stays in the open: thoughts render as quiet paragraphs
// on a rail, never folded behind a summary, live or done.
test("narration rail keeps thoughts and steps visible", async ({ page }, testInfo) => {
  for (const live of [true, false]) {
    await page.goto(`/e2e/fixtures/narration-preview.html?live=${live ? 1 : 0}`);
    const narration = page.getByTestId("narration");
    await expect(narration).toBeVisible();
    await expect(page.getByTestId("thought").first()).toBeVisible();
    await expect(page.getByTestId("thought").first()).toContainText("Checking Adzo's");
    await expect(page.getByTestId("tool-rows").first()).toContainText("Read file ×4");
    await expect(narration.locator("details, summary")).toHaveCount(0);
    await expect(page.getByTestId("live-status")).toHaveCount(live ? 1 : 0);
    if (live) await expect(page.getByTestId("live-status")).toContainText("Waiting for Chief");
    await captureScreenshot(page, testInfo, live ? "live" : "done");
  }
});

test("thinking off still shows interim prose and steps on the rail", async ({ page }) => {
  await page.goto("/e2e/fixtures/narration-preview.html?live=1&thinking=0");
  await expect(page.getByTestId("thought")).toHaveCount(0);
  await expect(page.locator(".rk-tl-interim")).toHaveCount(1);
  await expect(page.getByTestId("tool-rows").first()).toContainText("Shell");
  await expect(page.getByTestId("live-status")).toBeVisible();
});
