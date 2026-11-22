import path from "node:path";
import { expect, test } from "@playwright/test";

test("marketing page renders without the unverified bundled font", async ({ page }, testInfo) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (/aeonik/i.test(request.url())) fontRequests.push(request.url());
  });
  // Serve Geist from the repository; screenshots do not depend on Google Fonts or analytics.
  // The web app no longer installs @fontsource-variable/geist (it loads Geist from Google Fonts),
  // so the face comes from its bundled open-license Geist Pixel Grid file.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "fonts.googleapis.com") {
      await route.fulfill({
        contentType: "text/css",
        body: '@font-face { font-family: Geist; src: url("http://127.0.0.1:4321/__test-geist.woff2"); font-weight: 100 900; }',
      });
    } else if (url.pathname === "/__test-geist.woff2") {
      await route.fulfill({
        contentType: "font/woff2",
        path: path.resolve(import.meta.dirname, "../public/fonts/geist-pixel-grid.woff2"),
      });
    } else if (url.origin === "http://127.0.0.1:4321") {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  await page.goto("/");
  const heading = page.locator("h1").first();
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS("font-family", /Geist/);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      Array.from(document.fonts).some(
        (font) => font.family === "Geist" && font.status === "loaded",
      ),
    ),
  ).toBe(true);
  expect(fontRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("marketing-font.png"), fullPage: true });
});
