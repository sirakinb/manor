import { expect, test } from "@playwright/test";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

for (const [name, channel, source, tool, absent] of [
  ["Studio", null, null, null, null],
  ["Harbor Homes", "voice", "Voice source", "workspace_voice_calls", "workspace_email"],
  ["Summit Legal", "email", "Email source", "workspace_email", "workspace_voice_calls"],
]) {
  test(`documentation shows ${name}'s available tools`, async ({ page, context }, testInfo) => {
    const stamp = Date.now();
    const email = `docs-${stamp}@rakazo.test`;
    await signup(page, email, "password12", "Documentation Tester");
    await completeOnboarding(page);
    const { prisma, pool } = createDb(process.env.DATABASE_URL!);
    try {
      const member = await prisma.member.findFirstOrThrow({ where: { user: { email } } });
      await prisma.organization.update({
        where: { id: member.organizationId },
        data: { name: name! },
      });
      if (channel) {
        await prisma.workspace.create({
          data: {
            organizationId: member.organizationId,
            name: name!,
            slug: `docs-${stamp}`,
            channels: [channel],
            sources: { create: { name: source!, status: "connected" } },
          },
        });
      }
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/app/docs");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: `${name} API & MCP` })).toBeVisible();
    await main.getByRole("button", { name: "Copy setup prompt", exact: true }).click();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain(JSON.stringify(name));
    if (tool && absent) {
      await expect(main.getByText(source!, { exact: true })).toBeVisible();
      expect(prompt).toContain(tool);
      expect(prompt).not.toContain(absent);
      await main.getByRole("button", { name: "Workspace", exact: true }).click();
      await expect(main.getByText(tool!, { exact: true })).toBeVisible();
      await expect(main.getByText(absent!, { exact: true })).toHaveCount(0);
    } else {
      await expect(main.getByRole("button", { name: "Workspace", exact: true })).toHaveCount(0);
      expect(prompt).not.toContain("/mcp/workspace");
    }
    await captureScreenshot(
      page,
      testInfo,
      `documentation-${name!.toLowerCase().replaceAll(" ", "-")}`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await captureScreenshot(page, testInfo, "documentation-narrow");
  });
}
