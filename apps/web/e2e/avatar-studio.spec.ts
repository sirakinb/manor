import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("bot settings open Avatar Studio on the Bot tab", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `avatar-studio-${stamp}@rakazo.test`, "password12", "Avatar Studio");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await page.getByTestId("bot-settings-trigger").click();
  const settings = page.getByTestId("bot-settings");
  await expect(settings).toBeVisible();

  await settings.getByTestId("avatar-studio-trigger").click();
  const studio = page.getByTestId("avatar-studio");
  await expect(studio).toBeVisible();
  await expect(studio.getByText("Avatar Studio", { exact: true })).toBeVisible();
  await expect(studio.getByRole("tab", { name: "Bot", exact: true })).toBeVisible();
  await expect(studio.getByRole("tab", { name: "Upload", exact: true })).toBeVisible();
  await expect(studio.getByTestId("avatar-studio-bot-tab")).toBeVisible();

  // Manor offers no icon set choice: upstream's logo ("Rakazo") set draws upstream's mark.
  await expect(studio.getByRole("tab", { name: "Rakazo", exact: true })).toHaveCount(0);
  await expect(studio.getByRole("tab", { name: "Original", exact: true })).toHaveCount(0);
  const defaultLook = studio.getByTestId("avatar-studio-default");
  const wedge = studio.getByRole("button", { name: "wedge", exact: true });
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(wedge).toHaveAttribute("aria-pressed", "false");

  // Manor's sprite is how a bot on one of Manor's sprite colours is drawn when it has no chosen
  // shape and no uploaded image; a chosen shape wins over it, and a non-sprite colour shows
  // upstream's organic avatar. There is no avatar style setting any more.
  const organic = studio.locator(".rakazo-organic-avatar");
  const sprite = studio.locator(".rakazo-bot-avatar-sprite");

  await studio.getByRole("button", { name: "Color #8B5CF6" }).click();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(sprite).toHaveCount(1);
  await expect(sprite).toHaveAttribute("src", /\/sprites\/sprite-purple\.png$/);
  await expect(organic).toHaveCount(0);

  await wedge.click();
  await expect(wedge).toHaveAttribute("aria-pressed", "true");
  await expect(defaultLook).toHaveAttribute("aria-pressed", "false");
  await expect(sprite).toHaveCount(0);
  await expect(organic).toHaveCount(0);

  await defaultLook.click();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(wedge).toHaveAttribute("aria-pressed", "false");
  await expect(sprite).toHaveCount(1);
  await expect(organic).toHaveCount(0);

  await studio.getByRole("button", { name: "Color #EAB308" }).click();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(wedge).toHaveAttribute("aria-pressed", "false");
  await expect(organic.first()).toBeVisible();
  await expect(sprite).toHaveCount(0);

  await studio.getByRole("button", { name: "Color #8B5CF6" }).click();
  await wedge.click();
  await studio.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(wedge).toHaveAttribute("aria-pressed", "false");
  await expect(sprite).toHaveCount(1);
  await expect(organic).toHaveCount(0);

  await captureScreenshot(page, testInfo, "avatar-studio-bot-tab");

  // An uploaded image replaces the drawn avatar; the studio closes once the image is applied.
  await studio.getByRole("tab", { name: "Upload", exact: true }).click();
  await studio
    .locator('input[type="file"]')
    .setInputFiles(fileURLToPath(new URL("../public/sprites/sprite-red.png", import.meta.url)));
  await expect(studio).toBeHidden();
  const trigger = settings.getByTestId("avatar-studio-trigger");
  await expect(trigger.locator(".rakazo-bot-avatar-picture img")).toBeVisible();
  await expect(trigger.locator(".rakazo-bot-avatar-sprite")).toHaveCount(0);
});
