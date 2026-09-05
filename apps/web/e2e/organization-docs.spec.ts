import { expect, test } from "@playwright/test";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("documentation follows the selected organization and its available tools", async ({
  page,
  context,
}, testInfo) => {
  const stamp = Date.now();
  const email = `docs-${stamp}@rakazo.test`;
  await signup(page, email, "password12", "Documentation Tester");
  await completeOnboarding(page);
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  try {
    const member = await prisma.member.findFirstOrThrow({ where: { user: { email } } });
    await prisma.organization.update({
      where: { id: member.organizationId },
      data: { name: "Studio" },
    });
    for (const [suffix, name, channel, source] of [
      ["homes", "Harbor Homes", "voice", "Voice source"],
      ["legal", "Summit Legal", "email", "Email source"],
    ]) {
      const id = `docs-${stamp}-${suffix}`;
      await prisma.organization.create({
        data: { id, name: name!, slug: id, createdAt: new Date() },
      });
      await prisma.member.create({
        data: {
          id: `${id}-member`,
          organizationId: id,
          userId: member.userId,
          role: "owner",
          createdAt: new Date(),
        },
      });
      await prisma.space.create({ data: { id, organizationId: id, name: name! } });
      await prisma.spaceMember.create({
        data: {
          id: `${id}-space-member`,
          spaceId: id,
          organizationId: id,
          userId: member.userId,
          role: "owner",
          createdAt: new Date(),
        },
      });
      await prisma.workspace.create({
        data: {
          organizationId: id,
          name: name!,
          slug: id,
          channels: [channel!],
          sources: { create: { name: source!, status: "connected" } },
        },
      });
      await prisma.bot.create({
        data: {
          spaceId: id,
          userId: member.userId,
          name: `${name} assistant`,
          color: "#a855f7",
          thread: { create: { spaceId: id, userId: member.userId } },
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
  const sidebar = page.locator("aside").first();
  await expect(main.getByRole("heading", { name: "Studio API & MCP" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Workspace", exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Copy setup prompt", exact: true }).click();
  let prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('"Studio"');
  expect(prompt).not.toContain("/mcp/workspace");
  await captureScreenshot(page, testInfo, "documentation-studio");

  for (const [name, source, tool, absent] of [
    ["Harbor Homes", "Voice source", "workspace_voice_calls", "workspace_email"],
    ["Summit Legal", "Email source", "workspace_email", "workspace_voice_calls"],
  ]) {
    await sidebar.getByText(`${name} assistant`, { exact: true }).click();
    await sidebar.getByRole("button", { name: "Documentation", exact: true }).click();
    await expect(main.getByRole("heading", { name: `${name} API & MCP` })).toBeVisible();
    await expect(main.getByText(source!, { exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Copy setup prompt", exact: true }).click();
    await expect(main.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain(JSON.stringify(name));
    expect(prompt).toContain(tool!);
    expect(prompt).not.toContain(absent!);
    await main.getByRole("button", { name: "Workspace", exact: true }).click();
    await expect(main.getByText(tool!, { exact: true })).toBeVisible();
    await expect(main.getByText(absent!, { exact: true })).toHaveCount(0);
    await captureScreenshot(
      page,
      testInfo,
      `documentation-${name!.toLowerCase().replaceAll(" ", "-")}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await captureScreenshot(page, testInfo, "documentation-narrow");
});
