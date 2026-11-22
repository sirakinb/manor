import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  openUserSettings,
  signup,
} from "../helpers/helpers";

// Manor: the account-wide bot style is not offered, with or without a saved preference.
test("settings offer no bot style, even when bootstrap omits the saved preference", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.json.me.botAvatarSet;
    await route.fulfill({ response, json: body });
  });
  await signup(page, `bot-style-${Date.now()}@rakazo.test`, "password12", "Tester");
  await completeOnboarding(page);
  const settings = await openUserSettings(page);
  await expect(settings.getByText("Language", { exact: true })).toBeVisible();
  await expect(settings.getByTestId("bot-style-select")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "bot-style-not-offered");
});
