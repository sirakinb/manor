import { randomUUID } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { createDb, runAsSystem, runAsTenant, spaceResourceActor } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPage, listPages } from "./pages.js";

const enabled = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);

// Manor: pages are on the space tier, so a team space's members reach what its bots saved under
// the shared account, and nobody outside the space reaches it.
describe.skipIf(!enabled).sequential("pages in a shared team space (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  const suffix = randomUUID().slice(0, 8);
  const organizationId = `pages-org-${suffix}`;
  const otherOrganizationId = `pages-other-org-${suffix}`;
  const team = `pages-team-${suffix}`;
  const elsewhere = `pages-elsewhere-${suffix}`;
  const account = `pages-account-${suffix}`;
  const member = `pages-member-${suffix}`;
  const outsider = `pages-outsider-${suffix}`;
  const pageId = `pages-page-${suffix}`;
  const users = [account, member, outsider];

  /** The session actor a signed-in person has in a space, before the space tier resolves it. */
  const sessionActor = (
    userId: string,
    spaceId: string,
    org: string,
    spaceAccountUserId?: string,
  ): Actor => ({
    spaceId,
    organizationId: org,
    userId,
    email: `${userId}@rakazo.test`,
    isDeploymentOwner: false,
    ...(spaceAccountUserId ? { spaceAccountUserId } : {}),
  });
  /** What `spaceAuthed` does: resolve the space's account, then run in that tenant. */
  const asSpaceTier = async <T>(actor: Actor, work: (resolved: Actor) => Promise<T>) => {
    const resolved = await runAsTenant(actor, () => spaceResourceActor(prisma, actor));
    return runAsTenant(resolved, () => work(resolved));
  };

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
    await runAsSystem("pages team space fixture", async () => {
      for (const [id, name] of [
        [organizationId, "Pages team"],
        [otherOrganizationId, "Pages elsewhere"],
      ] as const) {
        await prisma.organization.create({ data: { id, name, slug: id, createdAt: new Date() } });
      }
      for (const userId of users) {
        await prisma.user.create({
          data: {
            id: userId,
            name: userId,
            email: `${userId}@rakazo.test`,
            emailVerified: true,
            isSpaceAccount: userId === account,
          },
        });
      }
      for (const [userId, org] of [
        [account, organizationId],
        [member, organizationId],
        [outsider, otherOrganizationId],
      ] as const) {
        await prisma.member.create({
          data: {
            id: `${userId}-m`,
            organizationId: org,
            userId,
            role: "owner",
            createdAt: new Date(),
          },
        });
      }
      await prisma.space.create({
        data: { id: team, organizationId, name: "Team", accountUserId: account },
      });
      await prisma.space.create({
        data: { id: elsewhere, organizationId: otherOrganizationId, name: "Elsewhere" },
      });
      for (const [userId, spaceId, org] of [
        [account, team, organizationId],
        [member, team, organizationId],
        [outsider, elsewhere, otherOrganizationId],
      ] as const) {
        await prisma.spaceMember.create({
          data: {
            id: `${userId}-${spaceId}`,
            organizationId: org,
            spaceId,
            userId,
            createdAt: new Date(),
          },
        });
      }
      const bot = await prisma.bot.create({
        data: { spaceId: team, userId: account, name: "Writer", color: "#A855F7" },
      });
      // A run in a team space acts as the shared account, so its pages are saved under it.
      await prisma.page.create({
        data: { id: pageId, spaceId: team, userId: account, botId: bot.id, title: "Plan" },
      });
      await prisma.pageVersion.create({
        data: { pageId, version: 1, title: "Plan", source: "source", code: "compiled" },
      });
    });
  });
  afterAll(async () => {
    if (prisma) {
      await runAsSystem("pages team space fixture", async () => {
        await prisma.pageVersion.deleteMany({ where: { pageId } });
        await prisma.page.deleteMany({ where: { id: pageId } });
        await prisma.bot.deleteMany({ where: { spaceId: team } });
        await prisma.organization.deleteMany({
          where: { id: { in: [organizationId, otherOrganizationId] } },
        });
        await prisma.user.deleteMany({ where: { id: { in: users } } });
      });
      await prisma.$disconnect();
      await db.pool.end();
    }
  });

  it("lists and opens a page the space's bot saved for a member of the space", async () => {
    const actor = sessionActor(member, team, organizationId, account);
    const listed = await asSpaceTier(actor, (resolved) => listPages(prisma, resolved, {}));
    expect(listed.items.map((page) => page.id)).toEqual([pageId]);
    const opened = await asSpaceTier(actor, (resolved) =>
      getPage({ prisma, secrets: {} as never, webOrigin: "https://manor.test" }, resolved, {
        pageId,
      }),
    );
    expect(opened).toMatchObject({ id: pageId, code: "compiled", shareUrl: null });
  });

  it("gives a member of another space nothing", async () => {
    const actor = sessionActor(outsider, elsewhere, otherOrganizationId);
    const listed = await asSpaceTier(actor, (resolved) => listPages(prisma, resolved, {}));
    expect(listed.items).toEqual([]);
    await expect(
      asSpaceTier(actor, (resolved) =>
        getPage({ prisma, secrets: {} as never, webOrigin: "https://manor.test" }, resolved, {
          pageId,
        }),
      ),
    ).rejects.toMatchObject({ name: "IsolationError" });
    // Claiming the team space without belonging to it is refused before any page is read.
    await expect(
      asSpaceTier(sessionActor(outsider, team, organizationId, account), (resolved) =>
        listPages(prisma, resolved, {}),
      ),
    ).rejects.toMatchObject({ name: "IsolationError" });
  });
});
