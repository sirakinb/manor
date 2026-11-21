import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

// Manor does not offer upstream's logo ("Rakazo") set, which draws upstream's mark.
test("the studio offers no icon set choice and keeps legacy, shapes and photos", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const theme of ["dark", "light"]) {
    await page.goto(`/e2e/fixtures/avatar-sets.html?theme=${theme}`);
    await page.evaluate(() => localStorage.removeItem("avatar-set-settings-fixture"));
    await page.reload();
    const legacy = page.getByTestId("legacy-sample"),
      photo = page.getByTestId("photo-sample"),
      shape = page.getByTestId("original-shape-sample");
    await expect(legacy.locator(".rakazo-organic-avatar")).toBeVisible();
    await expect(shape.locator(".bot-character-eyes")).toBeVisible();
    await expect(photo.locator("img")).toBeVisible();
    await legacy.getByTestId("avatar-studio-trigger").click();
    const studio = page.getByTestId("avatar-studio");
    await expect(studio).toBeVisible();
    await expect(studio.getByRole("tab", { name: "Rakazo", exact: true })).toHaveCount(0);
    await expect(studio.getByRole("tab", { name: "Original", exact: true })).toHaveCount(0);
    await captureScreenshot(page, testInfo, `avatar-set-studio-${theme}`);
    await studio.getByRole("button", { name: "Done", exact: true }).click();
    await page.reload();
    await expect(legacy.locator(".rakazo-organic-avatar")).toBeVisible();
    await expect(shape.locator(".bot-character-eyes")).toBeVisible();
    await expect(photo.locator("img")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("new-bot dialog defaults to Original and submits its explicit set", async ({
  page,
}, testInfo) => {
  await page.goto("/e2e/fixtures/avatar-sets.html");
  await page.getByRole("button", { name: "New bot", exact: true }).click();
  const dialog = page.getByTestId("create-bot-dialog");
  await expect(dialog.getByRole("tab", { name: "Rakazo", exact: true })).toHaveCount(0);
  await expect(dialog.locator(".rakazo-organic-avatar").first()).toBeVisible();
  await captureScreenshot(page, testInfo, "create-bot-default-original");
  await dialog.getByPlaceholder("Name your Bot").fill("New example");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const created = JSON.parse((await page.getByTestId("created-bot").textContent()) || "{}");
  expect(created).toMatchObject({ name: "New example", avatarSet: "organic" });
  expect(created).toHaveProperty("avatarFamily");
});
