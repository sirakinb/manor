import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { chatUserBubbleColors } from "@rakazo/core";
import { webDarkTokens } from "@rakazo/ui-tokens";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

function rgb(hex: string) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * A computed colour as [r, g, b, a] in 0–255, whatever space the browser reports it in (a
 * colour-mix comes back as oklab). The canvas converts it the way it would be painted.
 */
function paintedColor(locator: Locator, property: "color" | "background-color") {
  return locator.evaluate((element, name) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = getComputedStyle(element).getPropertyValue(name);
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, property);
}

// Manor is pinned to dark, so the bubble keeps Manor's dark colours whatever the OS or the
// stored preference asks for.
test("user bubbles stay close to the avatar color with white text on Manor's dark theme", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signup(page, `bubble-colors-${Date.now()}@rakazo.test`, "password12", "Bubble Demo");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "bots/update", { botId, color: "#FF781C" });
  await page.evaluate((theme) => localStorage.setItem("rakazo.uiAppearance", theme), "light");
  await page.reload();

  const message = "Let's plan the week ahead.";
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const bubble = page.getByTestId("message-user-bubble").filter({ hasText: message });
  await expect(bubble).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const colored = chatUserBubbleColors("#FF781C", botId)!;
  expect(colored.foreground).toBe("#FFFFFF");
  await expect(bubble).toHaveCSS("color", rgb(colored.foreground));
  await expect(bubble).toHaveCSS("background-color", rgb(colored.background));
  // The send button stays quiet on an empty draft...
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeDisabled();
  await expect(send).not.toHaveCSS("background-color", rgb(colored.background));
  await captureScreenshot(page, testInfo, "chat-bubble-avatar-color-dark");
  // ...and wears the bubble's color once there is something to send. The pointer leaves the
  // button first, since hovering it lightens the color.
  await composer.fill("And the week after.");
  await page.mouse.move(0, 0);
  await expect(send).toBeEnabled();
  await expect
    .poll(() => paintedColor(send, "background-color"))
    .toEqual(await paintedColor(bubble, "background-color"));
  await expect.poll(() => paintedColor(send, "color")).toEqual(await paintedColor(bubble, "color"));
  await captureScreenshot(page, testInfo, "chat-send-button-bot-color-dark");
  await composer.fill("");

  // A bot with no bubble colour keeps Manor's neutral bubble from the tokens.
  await rpc(page, "bots/update", { botId, color: "#FFFFFF" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(bubble).toHaveCSS("color", rgb(webDarkTokens.chatUserForeground));
  await expect(bubble).toHaveCSS("background-color", rgb(webDarkTokens.chatUser));
});
