import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, openUserSettings, rpc, signup } from "./helpers";

type OrganizationList = {
  organizations: Array<{ id: string; name: string; defaultSpaceId: string; spaceIds: string[] }>;
};

test.afterEach(async ({ page }) => {
  // Finish intercepted responses before the browser context is disposed.
  await page.unrouteAll({ behavior: "wait" });
});

function selectedSpace(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("rakazo:space-id"));
}

async function openAvatarMenu(page: Page) {
  await page.getByTestId("user-menu-trigger").click();
  const menu = page.locator('[data-slot="popover-content"]');
  await expect(menu.getByRole("button", { name: "Settings" })).toBeVisible();
  return menu;
}

// Manor: a session acts only in the organization its portal allows, so a person in two
// organizations sees one here, with no switcher and no "Create organization".
test("Manor shows one organization and offers no switcher or Create organization", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const email = `organizations-${stamp}@rakazo.test`;
  await signup(page, email, "password12", "Org Owner");
  await completeOnboarding(page);
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  const clientId = `org-client-${stamp}`;
  try {
    const member = await prisma.member.findFirstOrThrow({ where: { user: { email } } });
    await prisma.organization.update({
      where: { id: member.organizationId },
      data: { name: "Studio" },
    });
    await prisma.organization.create({
      data: { id: clientId, name: "Client Company", slug: clientId, createdAt: new Date() },
    });
    await prisma.member.create({
      data: {
        id: `${clientId}-member`,
        organizationId: clientId,
        userId: member.userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.space.create({
      data: { id: clientId, organizationId: clientId, name: "Client space" },
    });
    await prisma.spaceMember.create({
      data: {
        id: `${clientId}-space-member`,
        organizationId: clientId,
        spaceId: clientId,
        userId: member.userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.bot.create({
      data: {
        spaceId: clientId,
        userId: member.userId,
        name: "Client assistant",
        color: "#a855f7",
        thread: { create: { spaceId: clientId, userId: member.userId } },
      },
    });
    await page.reload();

    // The list holds only the organization this portal allows.
    const { organizations } = await rpc<OrganizationList>(page, "organizations/list", {});
    expect(organizations.map((organization) => organization.name)).toEqual(["Studio"]);

    // The account menu lists no organizations.
    const menu = await openAvatarMenu(page);
    await expect(menu.getByRole("button", { name: "Studio", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Client Company", exact: true })).toHaveCount(0);
    await captureScreenshot(page, testInfo, "org-menu-single");
    await page.keyboard.press("Escape");

    // Settings > Organization names it, with nothing to create or delete.
    const settings = await openUserSettings(page);
    await settings.getByTestId("settings-nav-organization").click();
    const panel = settings.getByTestId("organization-settings");
    await expect(panel).toBeVisible();
    const name = panel.getByLabel("Name");
    if ((await name.count()) > 0) await expect(name).toHaveValue("Studio");
    else await expect(panel.getByText("Studio", { exact: true })).toBeVisible();
    await expect(settings.getByRole("button", { name: "Create organization" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Delete organization" })).toHaveCount(0);
    await expect(settings.getByText("Client Company", { exact: true })).toHaveCount(0);
    await captureScreenshot(page, testInfo, "org-settings-single");

    // The server refuses adding or removing an organization, saying why.
    for (const [procedure, input] of [
      ["organizations/create", { name: "Work" }],
      ["organizations/remove", { organizationId: member.organizationId }],
    ] as const) {
      const refused = await page.request.post(`/rpc/${procedure}`, { data: { json: input } });
      expect(refused.status(), procedure).toBe(403);
      const body = (await refused.json()) as {
        json?: { code?: string; data?: { reason?: string } };
      };
      expect(body.json?.code, procedure).toBe("FORBIDDEN");
      expect(body.json?.data?.reason, procedure).toBe("ORGANIZATIONS_UNAVAILABLE");
    }
    expect(
      (await rpc<OrganizationList>(page, "organizations/list", {})).organizations,
    ).toHaveLength(1);

    // A browser holding the other organization's Space, and its saved place there, recovers to
    // the account's own Space instead of an empty shell.
    await page.evaluate((id) => {
      window.localStorage.setItem("rakazo:space-id", id);
      window.localStorage.setItem("rakazo:org-spaces", JSON.stringify({ [id]: id }));
    }, clientId);
    await page.goto("/app");
    const sidebar = page.locator("aside").first();
    await expect(sidebar.getByRole("button", { name: /^Chief/ })).toBeVisible();
    // The saved space is dropped and the page reloads into the account's own space with nothing
    // saved, as on a fresh sign-in.
    await expect.poll(() => selectedSpace(page)).toBeNull();
    await expect(sidebar.getByText("Client Company", { exact: true })).toHaveCount(0);
    await expect(sidebar.getByText("Client assistant", { exact: true })).toHaveCount(0);
    await captureScreenshot(page, testInfo, "org-recovered-own-space");

    // A reload stays on the own Space.
    await page.reload();
    await expect(sidebar.getByRole("button", { name: /^Chief/ })).toBeVisible();
    expect(await selectedSpace(page)).toBeNull();
    await expect(sidebar.getByText("Client assistant", { exact: true })).toHaveCount(0);
    await expect(sidebar.getByText("Client Company", { exact: true })).toHaveCount(0);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
});
