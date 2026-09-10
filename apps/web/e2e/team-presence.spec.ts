import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { brandById } from "@rakazo/brands";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("branded team shows active and last-seen members without exposing other organizations", async ({
  page,
}, testInfo) => {
  const email = `team-${randomUUID()}@rakazo.test`;
  await signup(page, email, "password12", "Team Tester");
  await completeOnboarding(page);
  const signupCookies = await page.context().cookies();
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  const teammateId = randomUUID();
  let organizationId: string | undefined;
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const membership = await prisma.member.findFirstOrThrow({ where: { userId: user.id } });
    organizationId = membership.organizationId;
    await prisma.organization.update({
      where: { id: organizationId },
      data: { brandId: "vibecodephilly", name: "Vibe Code Philly" },
    });
    await prisma.user.create({
      data: {
        id: teammateId,
        email: `teammate-${teammateId}@rakazo.test`,
        name: "Team Colleague",
        lastSignedInAt: new Date("2026-09-01T12:00:00Z"),
      },
    });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: teammateId,
        role: "member",
        createdAt: new Date(),
        lastActiveAt: new Date("2026-09-02T12:00:00Z"),
      },
    });
    await page.route(/\/(?:api\/auth|rpc)\//, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const response = await route.fetch({
        url: new URL(`${url.pathname}${url.search}`, process.env.API_URL!).toString(),
        headers: { ...request.headers(), host: brandById("vibecodephilly")!.hostnames[0]! },
      });
      await route.fulfill({ response });
    });
    await page.goto("/app?__brand=vibecodephilly");
    await page.getByTestId("user-menu-trigger").click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const team = page.getByRole("region", { name: "Team", exact: true });
    await expect(team.getByTestId("team-member")).toHaveCount(2);
    await expect(team.getByText("Team Colleague", { exact: true })).toBeVisible();
    await expect(team.getByText("Last active", { exact: false })).toBeVisible();
    await expect(team.getByText("Last sign-in", { exact: false })).toHaveCount(2);
    await expect(team.getByText("Active now", { exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-brand", "vibecodephilly");
    await team.scrollIntoViewIfNeeded();
    await captureScreenshot(page, testInfo, "vibecodephilly-team-presence");
    await page.context().clearCookies();
    await page.goto("/sign-in?__brand=vibecodephilly");
    await expect(page.getByRole("img", { name: "Vibe Code Philly" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in to Vibe Code Philly" })).toHaveClass(
      "sr-only",
    );
    await captureScreenshot(page, testInfo, "vibecodephilly-sign-in");
  } finally {
    try {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      if (organizationId)
        await prisma.organization.update({
          where: { id: organizationId },
          data: { brandId: null },
        });
      await prisma.user.deleteMany({ where: { id: teammateId } });
      await page.context().addCookies(signupCookies);
      const removed = await page.request.post("/api/auth/delete-user", {
        data: { password: "password12" },
        headers: { origin: new URL(page.url()).origin },
      });
      expect(removed.ok()).toBe(true);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      if (organizationId)
        expect(await prisma.organization.findUnique({ where: { id: organizationId } })).toBeNull();
    } finally {
      try {
        await prisma.$disconnect();
      } finally {
        await pool.end();
      }
    }
  }
});
