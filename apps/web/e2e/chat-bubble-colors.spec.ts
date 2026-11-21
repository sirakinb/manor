import { expect, test } from "@playwright/test";
import { chatUserBubbleColors } from "@rakazo/core";
import { webDarkTokens } from "@rakazo/ui-tokens";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

function rgb(hex: string) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

// Manor is pinned to dark, so the bubble keeps Manor's dark colours whatever the OS or the
// stored preference asks for.
test("colored user bubbles keep white text on Manor's dark theme", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signup(page, `bubble-colors-${Date.now()}@rakazo.test`, "password12", "Bubble Demo");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "bots/update", { botId, color: "#A855F7" });
  await page.evaluate((theme) => localStorage.setItem("rakazo.uiAppearance", theme), "light");
  await page.reload();

  const message = "Let's plan the week ahead.";
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const bubble = page.getByTestId("message-user-bubble").filter({ hasText: message });
  await expect(bubble).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const colored = chatUserBubbleColors("#A855F7", botId)!;
  expect(colored.foreground).toBe("#FFFFFF");
  await expect(bubble).toHaveCSS("color", rgb(colored.foreground));
  await expect(bubble).toHaveCSS("background-color", rgb(colored.background));
  // The send button stays quiet on an empty draft...
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeDisabled();
  await expect(send).not.toHaveCSS("background-color", rgb(colored.background));
  await captureScreenshot(page, testInfo, "chat-bubble-white-text-dark");
  // ...and wears the bubble's color once there is something to send.
  await composer.fill("And the week after.");
  await expect(send).toHaveCSS("background-color", rgb(colored.background));
  await expect(send).toHaveCSS("color", rgb(colored.foreground));
  await captureScreenshot(page, testInfo, "chat-send-button-bot-color-dark");
  await composer.fill("");

  // A bot with no bubble colour keeps Manor's neutral bubble from the tokens.
  await rpc(page, "bots/update", { botId, color: "#FFFFFF" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(bubble).toHaveCSS("color", rgb(webDarkTokens.chatUserForeground));
  await expect(bubble).toHaveCSS("background-color", rgb(webDarkTokens.chatUser));
});
