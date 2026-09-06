import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { brandById } from "@rakazo/brands";
import { createDb } from "../../../packages/db/src/client";
import { createDemoWorkspace } from "../../../packages/db/src/demo-workspace";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("demo has isolated sample operations and yellow branding", async ({ page }, testInfo) => {
  const email = `demo-${randomUUID()}@rakazo.test`;
  await signup(page, email, "password12", "Demo Tester");
  await completeOnboarding(page);
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  let organizationId: string | undefined;
  try {
    const demo = await createDemoWorkspace(prisma);
    organizationId = demo.organizationId;
    await expect(createDemoWorkspace(prisma)).rejects.toThrow("already exists");
    expect(
      await prisma.workspaceCredential.count({ where: { workspaceId: demo.workspaceId } }),
    ).toBe(0);
    expect(
      await prisma.workspaceAutomation.count({
        where: { workspaceId: demo.workspaceId, enabled: true },
      }),
    ).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: demo.spaceId, userId: user.id } },
      update: { role: "owner" },
      create: {
        id: randomUUID(),
        organizationId,
        spaceId: demo.spaceId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.bot.create({
      data: {
        spaceId: demo.spaceId,
        userId: user.id,
        name: "Meridian assistant",
        color: "#e9bd38",
        thread: { create: { spaceId: demo.spaceId, userId: user.id } },
      },
    });
    // Exercise the client's portal boundary while serving the UI from local Vite.
    await page.route(/\/(?:api\/auth|rpc)\//, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const response = await route.fetch({
        url: new URL(`${url.pathname}${url.search}`, process.env.API_URL!).toString(),
        headers: { ...request.headers(), host: brandById("meridian")!.hostnames[0]! },
      });
      await route.fulfill({ response });
    });
    await page.goto("/app?__brand=meridian");
    const sidebar = page.locator("aside").first();
    await sidebar.getByText("Meridian assistant", { exact: true }).click();
    await sidebar.getByRole("button", { name: "Workspace", exact: true }).click();
    const main = page.locator("main");
    await expect(page.getByTestId("workspace-stats")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-brand", "meridian");
    await captureScreenshot(page, testInfo, "meridian-overview");
    for (const section of [
      "Voice",
      "Email",
      "Social",
      "Leasing",
      "Utilities",
      "Reports",
      "System",
    ]) {
      await page
        .getByTestId("workspace-tabs")
        .getByRole("button", { name: section, exact: true })
        .click();
      const heading =
        section === "Email"
          ? "Email performance"
          : section === "Social"
            ? "Instagram performance"
            : section;
      await expect(main.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(main.getByText("Loading", { exact: true })).toHaveCount(0);
      await expect(main.getByRole("alert")).toHaveCount(0);
      await expect(main.getByText(/Unable to load|Something went wrong/)).toHaveCount(0);
      await captureScreenshot(page, testInfo, `meridian-${section.toLowerCase()}`);
    }
    await sidebar.getByRole("button", { name: "Documentation", exact: true }).click();
    await expect(
      main.getByRole("heading", { name: "Meridian Properties API & MCP" }),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, "meridian-documentation");
  } finally {
    // Thread subscriptions are intentionally long-lived; close the local portal bridge on teardown.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (organizationId) await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
    await pool.end();
  }
});
