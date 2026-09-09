import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ javaScriptEnabled: false });

test("Manor link preview is available without JavaScript or sign-in", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Manor — Your team of always-on AI agents",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  const imageUrl = new URL(
    (await page.locator('meta[property="og:image"]').getAttribute("content"))!,
  );
  expect(imageUrl.protocol).toBe("https:");
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    "content",
    imageUrl.href,
  );
  // Request the deployed asset path on the test server, without contacting production.
  const image = await page.request.get(imageUrl.pathname);
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toContain("image/jpeg");
  expect((await image.body()).length).toBeLessThan(1_000_000);
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(imageUrl.pathname);
  await expect(page.locator("img")).toBeVisible();
  await captureScreenshot(page, testInfo, "manor-social-card");
});
