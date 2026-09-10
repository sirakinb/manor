import { expect, test } from "@playwright/test";
import type { AppBootstrap } from "@rakazo/contracts";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

for (const deploymentOwner of [false, true]) {
  test(`retired maintenance UI stays hidden for ${deploymentOwner ? "deployment" : "organization"} owners`, async ({
    page,
  }, testInfo) => {
    await signup(
      page,
      `retired-maintenance-${Date.now()}@example.test`,
      "password12",
      "Settings tester",
    );
    await completeOnboarding(page);
    // Exercise both UI roles without mutating the deployment owner shared by other specs.
    await page.route("**/rpc/bootstrap", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { json: AppBootstrap };
      body.json.me.isDeploymentOwner = deploymentOwner;
      await route.fulfill({ response, json: body });
    });
    await page.goto("/app/maintenance?runId=retired-bookmark");
    await expect(page).not.toHaveURL(/\/app\/maintenance/);
    await expect(page).toHaveURL(/\/app(?:\/[^/?]+)?$/);
    await expect(page.getByText("Chief").first()).toBeVisible();
    await expect(page.getByTestId("maintenance-page")).toHaveCount(0);
    await page.getByTestId("user-menu-trigger").click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByTestId("user-settings")).toBeVisible();
    await expect(page.getByRole("link", { name: "Maintenance Agent" })).toHaveCount(0);
    await captureScreenshot(
      page,
      testInfo,
      `settings-without-maintenance-${deploymentOwner ? "owner" : "member"}`,
    );
  });
}
