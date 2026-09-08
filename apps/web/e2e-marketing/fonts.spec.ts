import { expect, test } from "@playwright/test";

test("marketing page renders without the unverified bundled font", async ({ page }, testInfo) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (/aeonik/i.test(request.url())) fontRequests.push(request.url());
  });
  await page.goto("/");
  const heading = page.locator("h1").first();
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS("font-family", /Geist/);
  await page.evaluate(() => document.fonts.ready);
  expect(fontRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("marketing-font.png"), fullPage: true });
});
