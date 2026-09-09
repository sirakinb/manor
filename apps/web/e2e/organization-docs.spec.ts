import { expect, test } from "@playwright/test";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("user guides remain available when the API reference cannot load", async ({
  page,
}, testInfo) => {
  await signup(page, `guide-${Date.now()}@rakazo.test`, "password12", "Guide Tester");
  await completeOnboarding(page);
  await page.route("**/rpc/workspace/access", (route) => route.abort());
  await page.goto("/app/docs");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Your first useful task" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Getting started", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(main.getByRole("button", { name: "Copy setup prompt" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: /OpenAPI/ })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "documentation-getting-started");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [topic, heading] of [
    ["Working with agents", "Get better results from your agents"],
    ["Business data", "Keep your business context organized"],
    ["Getting started", "Your first useful task"],
  ]) {
    await main.getByRole("button", { name: topic, exact: true }).click();
    await expect(main.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await captureScreenshot(page, testInfo, "documentation-getting-started-narrow");
  await main.getByRole("button", { name: "Connect other agents", exact: true }).click();
  await expect(main.getByRole("alert")).toHaveText("Could not load organization access.");
  await main.getByRole("button", { name: "Getting started", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Your first useful task" })).toBeVisible();
  await main.getByRole("button", { name: "Connect other agents", exact: true }).click();
  await expect(main.getByRole("alert")).toBeVisible();
  await page.unroute("**/rpc/workspace/access");
  await main.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(main.getByRole("button", { name: "Copy setup prompt", exact: true })).toBeVisible();
});

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
    await main.getByRole("button", { name: "Connect other agents", exact: true }).click();
    await expect(main.getByRole("heading", { name: `Connect an agent to ${name}` })).toBeVisible();
    const picker = main.getByRole("group", { name: "AI tool" });
    await expect(picker.getByRole("button", { name: "Claude Code", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(() =>
        picker
          .locator("img")
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    await captureScreenshot(page, testInfo, "documentation-client-picker");
    await picker.getByRole("button", { name: "Cursor", exact: true }).click();
    const instructions = main.getByTestId("mcp-client-instructions");
    await main.getByRole("button", { name: "Copy configuration", exact: true }).click();
    await expect(main.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    const cursorConfig = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(Object.values(cursorConfig.mcpServers)).toEqual([
      {
        url: `${new URL(page.url()).origin}/mcp/crm`,
        headers: { Authorization: "Bearer REPLACE_WITH_MANOR_TOKEN" },
      },
    ]);
    await picker.getByRole("button", { name: "Codex", exact: true }).click();
    await expect(instructions).toContainText("--bearer-token-env-var MANOR_API_TOKEN");
    await expect(instructions).not.toContainText("claude mcp add");
    if (channel) {
      await main.getByRole("radio", { name: "Both", exact: true }).check();
      await expect(instructions).toContainText("/mcp/crm");
      await expect(instructions).toContainText("/mcp/workspace");
      await main.getByRole("radio", { name: "Shared knowledge", exact: true }).check();
      await expect(instructions).not.toContainText("/mcp/crm");
      await main.getByRole("radio", { name: "Contacts & deals", exact: true }).check();
    } else {
      await expect(main.getByRole("radio", { name: "Shared knowledge", exact: true })).toHaveCount(
        0,
      );
    }
    await picker.getByRole("button", { name: "Other", exact: true }).click();
    await expect(main.getByRole("button", { name: "Copy authorization header" })).toBeVisible();
    await picker.getByRole("button", { name: "Claude Code", exact: true }).click();
    await main.getByRole("button", { name: "Copy setup prompt", exact: true }).click();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain(JSON.stringify(name));
    await captureScreenshot(page, testInfo, "documentation-connect-agent");
    if (tool && absent) {
      await main.getByText("Connected workspace data", { exact: true }).click();
      await expect(main.getByText(source!, { exact: true })).toBeVisible();
      expect(prompt).toContain(tool);
      expect(prompt).not.toContain(absent);
      await main.getByText("Workspace tools and connection details", { exact: true }).click();
      await expect(main.getByText(tool!, { exact: true })).toBeVisible();
      await expect(main.getByText(absent!, { exact: true })).toHaveCount(0);
    } else {
      await expect(
        main.getByText("Workspace tools and connection details", { exact: true }),
      ).toHaveCount(0);
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
    if (tool) {
      const endpoints = main.locator("details[open]").getByTestId("documentation-endpoints");
      await expect(endpoints).toBeVisible();
      // Long paths, permission names, and descriptions must fit inside the list,
      // not just inside a page whose overflow is hidden.
      expect(
        await endpoints.evaluate((list) => {
          const bounds = list.getBoundingClientRect();
          return (
            list.scrollWidth <= list.clientWidth + 1 &&
            Array.from(list.querySelectorAll("li, p")).every((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.left >= bounds.left &&
                rect.right <= bounds.right + 1 &&
                node.scrollWidth <= node.clientWidth + 1
              );
            })
          );
        }),
      ).toBe(true);
      await endpoints.scrollIntoViewIfNeeded();
    }
    await captureScreenshot(page, testInfo, "documentation-narrow");
  });
}
