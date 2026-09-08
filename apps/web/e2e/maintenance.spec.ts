import { expect, test } from "@playwright/test";
import type { MaintenanceOverview, Me } from "@rakazo/contracts";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("deployment owner reviews a simulated maintenance fix and preserves a draft", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const db = createDb(process.env.DATABASE_URL!);
  let originalOwner: string | null | undefined;
  try {
    await signup(
      page,
      `maintenance-${Date.now()}@example.test`,
      "password12",
      "Maintenance tester",
    );
    await completeOnboarding(page);
    const me = await rpc<Me>(page, "me", {});
    originalOwner = (
      await db.prisma.deploymentSettings.findUniqueOrThrow({ where: { id: "default" } })
    ).ownerUserId;
    await db.prisma.deploymentSettings.update({
      where: { id: "default" },
      data: { ownerUserId: me.userId },
    });
    await page.goto("/app/maintenance");
    await page
      .getByRole("textbox", { name: "Bug or improvement" })
      .fill("The synthetic status label needs a clearer ready state.");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Bug or improvement" })).toHaveValue(
      "The synthetic status label needs a clearer ready state.",
    );
    await page.getByRole("button", { name: "Submit issue", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve simulated release" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByText("Review diff", { exact: true }).click();
    await page.getByText("Release manifest", { exact: true }).click();
    await expect(page.getByTestId("maintenance-job")).toContainText("sha256:");
    await expect(page.getByTestId("maintenance-job")).toContainText(
      "export const status = 'ready'",
    );
    await captureScreenshot(page, testInfo, "maintenance-owner-review");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "Approve simulated release" })).toBeVisible();
    await page.getByTestId("maintenance-job").scrollIntoViewIfNeeded();
    await captureScreenshot(page, testInfo, "maintenance-owner-review-mobile");
    await page.getByRole("button", { name: "Approve simulated release" }).click();
    await page.getByRole("button", { name: "Confirm simulated release" }).click();
    await expect(page.getByTestId("maintenance-job")).toContainText("Simulation completed", {
      timeout: 60_000,
    });
    await page.reload();
    await expect(page.getByTestId("maintenance-job")).toContainText(
      "No source code or deployment was changed",
      { ignoreCase: true },
    );
    const jobs = await rpc<MaintenanceOverview>(page, "maintenance/list", {});
    expect(jobs.jobs[0]?.approvedRevision).toBe("b".repeat(40));
    await captureScreenshot(page, testInfo, "maintenance-simulated-completion");
  } finally {
    if (originalOwner !== undefined)
      await db.prisma.deploymentSettings.update({
        where: { id: "default" },
        data: { ownerUserId: originalOwner },
      });
    await db.prisma.$disconnect();
    await db.pool.end();
  }
});

test("ordinary organization owner has no maintenance UI or API access", async ({
  page,
}, testInfo) => {
  await signup(
    page,
    `maintenance-member-${Date.now()}@example.test`,
    "password12",
    "Organization tester",
  );
  await completeOnboarding(page);
  await page.goto("/app/maintenance");
  await expect(page.getByRole("alert")).toContainText("restricted to the deployment owner");
  await expect(page.getByRole("textbox", { name: "Bug or improvement" })).toHaveCount(0);
  const response = await page.request.post("/rpc/maintenance/list", { data: { json: {} } });
  expect(response.status()).toBe(403);
  await captureScreenshot(page, testInfo, "maintenance-nonowner-denied");
});
