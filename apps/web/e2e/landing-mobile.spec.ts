import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

for (const width of [320, 390, 1440]) {
  test(`landing wordmark fits at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const canvas = page.locator(".lp-wordmark canvas");
    await expect(canvas).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(async () =>
        canvas.evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          const context = canvas.getContext("2d")!;
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          let left = canvas.width;
          let right = -1;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              if (data[(y * canvas.width + x) * 4 + 3]! > 32) {
                left = Math.min(left, x);
                right = Math.max(right, x);
              }
            }
          }
          return right > left ? Math.min(left, canvas.width - 1 - right) : 0;
        }),
      )
      .toBeGreaterThan(4);
    await expect(page.getByRole("button", { name: "Watch it work" })).toBeVisible();
    await captureScreenshot(page, testInfo, `landing-${width}`);
  });
}
