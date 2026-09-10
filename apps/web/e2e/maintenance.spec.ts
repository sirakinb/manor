import { expect, test } from "@playwright/test";
import type { Me } from "@rakazo/contracts";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

for (const deploymentOwner of [false, true]) {
  test(`retired maintenance UI stays hidden for ${deploymentOwner ? "deployment" : "organization"} owners`, async ({
    page,
  }, testInfo) => {
    const db = createDb(process.env.DATABASE_URL!);
    let originalOwner: string | null | undefined;
    try {
      await signup(
        page,
        `retired-maintenance-${Date.now()}@example.test`,
        "password12",
        "Settings tester",
      );
      await completeOnboarding(page);
      if (deploymentOwner) {
        const me = await rpc<Me>(page, "me", {});
        originalOwner = (
          await db.prisma.deploymentSettings.findUniqueOrThrow({ where: { id: "default" } })
        ).ownerUserId;
        await db.prisma.deploymentSettings.update({
          where: { id: "default" },
          data: { ownerUserId: me.userId },
        });
      }
      await page.goto("/app/maintenance?runId=retired-bookmark");
      await expect(page).toHaveURL(/\/app(?:\/[^?]+)?$/);
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
    } finally {
      if (originalOwner !== undefined) {
        await db.prisma.deploymentSettings.update({
          where: { id: "default" },
          data: { ownerUserId: originalOwner },
        });
      }
      await db.prisma.$disconnect();
      await db.pool.end();
    }
  });
}
