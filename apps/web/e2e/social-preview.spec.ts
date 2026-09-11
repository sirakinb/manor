import { expect, test } from "@playwright/test";
import { brandById, brands } from "@rakazo/brands";
import { captureScreenshot } from "./helpers";

test.use({ javaScriptEnabled: false });

test("Manor link preview is available without JavaScript or sign-in", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "AI Agents For Service Businesses",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  const imageUrl = new URL(
    (await page.locator('meta[property="og:image"]').getAttribute("content"))!,
  );
  expect(imageUrl.protocol).toBe("https:");
  expect(imageUrl.pathname).toBe("/manor-social-card-v2.jpg");
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

test("organization previews follow the request host without JavaScript", async ({
  page,
}, testInfo) => {
  const brand = brandById("vibecodephilly")!;
  await page.route("**/*", async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch({ headers: { host: brand.hostnames[0]! } });
    await route.fulfill({ response });
  });
  for (const pathname of ["/", "/index.html", "/sign-in"]) {
    await page.goto(pathname);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "Your Team Of Always-On Agents",
    );
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
      "content",
      "Your Team Of Always-On Agents",
    );
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      "content",
      brand.name,
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      `https://${brand.hostnames[0]}/`,
    );
  }
  const imageUrl = new URL(
    (await page.locator('meta[property="og:image"]').getAttribute("content"))!,
  );
  expect(imageUrl.href).toBe(`https://${brand.hostnames[0]}${brand.socialPreview!.image}`);
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    "content",
    imageUrl.href,
  );
  const image = await page.request.get(imageUrl.pathname, {
    headers: { host: brand.hostnames[0]! },
  });
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toContain("image/png");
  const bytes = await image.body();
  expect(bytes.readUInt32BE(16)).toBe(brand.socialPreview!.width);
  expect(bytes.readUInt32BE(20)).toBe(brand.socialPreview!.height);
  await page.setViewportSize({ width: 1048, height: 1062 });
  await page.goto(imageUrl.pathname);
  await expect(page.locator("img")).toBeVisible();
  await captureScreenshot(page, testInfo, "organization-social-card");

  // A shared web server must not leak a prior request's organization into another host.
  for (const other of brands.filter((candidate) => !candidate.socialPreview)) {
    const response = await page.request.get("/", { headers: { host: other.hostnames[0]! } });
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('content="AI Agents For Service Businesses"');
    expect(await response.text()).not.toContain('content="Your Team Of Always-On Agents"');
  }
});
