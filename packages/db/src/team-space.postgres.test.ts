import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelDeactivatedAccountRuns } from "./account-status.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { teamComputerUserId } from "./computers.js";
import { createThreadMessage, loadMessageAuthors } from "./messages.js";
import { createRepos } from "./repos.js";
import { asSystem, runAsSystem, runAsTenant } from "./row-security.js";
import { createSpaceAccount } from "./space-account.js";
import {
  leaveInvitedSpaces,
  leaveSpace,
  listSpaceMembers,
  removeSpaceMember,
  spaceIsShared,
} from "./space-members.js";
import { TeamSpaceSharingError } from "./team-space.js";
import { markThreadReadFor } from "./thread-reads.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE && databaseUrl ? describe : describe.skip;

// Manor's team space: Ada, Bea and Cy are people in the organization; the space also has its shared
// account, which owns the bot. Nobody holds an owner role in the space.
describePostgres("a Manor team space beside upstream's shared spaces (PostgreSQL)", () => {
  const suffix = randomUUID();
  const ada = `team-ada-${suffix}`;
  const bea = `team-bea-${suffix}`;
  const cy = `team-cy-${suffix}`;
  const organization = `team-org-${suffix}`;
  const space = `team-space-${suffix}`;
  let account = "";
  let botId = "";
  let threadId = "";
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
    const fixture = asSystem(prisma);
    const now = new Date();
    await fixture.organization.create({
      data: { id: organization, name: "Team", slug: organization, createdAt: now },
    });
    await fixture.space.create({
      data: { id: space, organizationId: organization, name: "Team", isDefault: false },
    });
    account = await runAsSystem("test fixture", () =>
      prisma.$transaction((tx) =>
        createSpaceAccount(tx, { id: space, organizationId: organization, name: "Team" }),
      ),
    );
    for (const id of [ada, bea, cy]) {
      await fixture.user.create({
        data: { id, name: id.split("-")[1]!, email: `${id}@example.test`, emailVerified: true },
      });
      // The organization trigger adds each new member to the team space.
      await fixture.member.create({
        data: {
          id: randomUUID(),
          organizationId: organization,
          userId: id,
          role: "member",
          createdAt: now,
        },
      });
    }
    const bot = await fixture.bot.create({
      data: {
        spaceId: space,
        userId: account,
        name: "Leasing",
        color: "#8B5CF6",
        thread: { create: { spaceId: space, userId: account } },
      },
      include: { thread: true },
    });
    botId = bot.id;
    threadId = bot.thread!.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await asSystem(prisma).space.deleteMany({ where: { id: space } });
    await asSystem(prisma).organization.deleteMany({ where: { id: organization } });
    await asSystem(prisma).user.deleteMany({ where: { id: { in: [ada, bea, cy, account] } } });
    await close();
  });

  const as = <T>(userId: string, fn: () => Promise<T>) =>
    runAsTenant({ spaceId: space, userId }, fn);
  const teamActor = (person: string) => ({
    spaceId: space,
    organizationId: organization,
    userId: account,
    initiatedByUserId: person,
    spaceAccountUserId: account,
    email: "",
    isDeploymentOwner: false,
  });
  const unreadFor = async (person: string) =>
    (await as(person, () => createRepos(prisma).listBots(teamActor(person)))).find(
      (bot) => bot.id === botId,
    )?.unread;

  it("is shared, lists only people, and keeps the shared account's Team Computer", async () => {
    await expect(asSystem(prisma).spaceMember.count({ where: { spaceId: space } })).resolves.toBe(
      4,
    );
    await expect(spaceIsShared(asSystem(prisma), space)).resolves.toBe(true);
    const listed = await as(ada, () => listSpaceMembers(prisma, { spaceId: space, userId: ada }));
    expect(listed.members.map((member) => member.userId).sort()).toEqual([ada, bea, cy].sort());
    await expect(
      teamComputerUserId(asSystem(prisma), { spaceId: space, userId: account }),
    ).resolves.toBe(account);
  });

  it("gives each person their own unread state and never marks the shared account", async () => {
    await as(account, () =>
      createThreadMessage(prisma, {
        threadId,
        role: "bot",
        blocks: [{ kind: "text", text: "Two showings booked." }],
      }),
    );
    expect(await unreadFor(ada)).toBe(true);
    expect(await unreadFor(bea)).toBe(true);
    await expect(
      asSystem(prisma).threadRead.count({ where: { threadId, userId: account } }),
    ).resolves.toBe(0);

    await as(ada, () => markThreadReadFor(prisma, { threadId, spaceId: space, userId: ada }));
    expect(await unreadFor(ada)).toBe(false);
    expect(await unreadFor(bea)).toBe(true);
  });

  it("refuses to take the shared account out of its team space", async () => {
    await asSystem(prisma).spaceMember.updateMany({
      where: { spaceId: space, userId: ada },
      data: { role: "owner" },
    });
    await expect(
      removeSpaceMember(prisma, { spaceId: space, userId: ada, memberUserId: account }),
    ).rejects.toBeInstanceOf(TeamSpaceSharingError);
    await expect(leaveInvitedSpaces(prisma, account, async () => undefined)).resolves.toEqual([]);
    await expect(
      asSystem(prisma).spaceMember.count({ where: { spaceId: space, userId: account } }),
    ).resolves.toBe(1);
    await asSystem(prisma).spaceMember.updateMany({
      where: { spaceId: space, userId: ada },
      data: { role: "member" },
    });
  });

  it("lets a person leave without handing anything over, even with no owner in the space", async () => {
    await expect(leaveSpace(prisma, { spaceId: space, userId: bea })).resolves.toMatchObject({
      cancelledRunIds: [],
    });
    await expect(
      asSystem(prisma).spaceMember.count({ where: { spaceId: space, userId: bea } }),
    ).resolves.toBe(0);
    await expect(asSystem(prisma).threadRead.count({ where: { userId: bea } })).resolves.toBe(0);
    await expect(
      asSystem(prisma).bot.findUniqueOrThrow({ where: { id: botId }, select: { userId: true } }),
    ).resolves.toEqual({ userId: account });
  });

  it("takes a deactivated person out of the team space and leaves the shared account's work", async () => {
    await asSystem(prisma).user.update({ where: { id: cy }, data: { deactivatedAt: new Date() } });
    const departed = await leaveInvitedSpaces(prisma, cy, async () => undefined, {
      deactivated: true,
    });
    expect(departed.map((departure) => departure.spaceId)).toEqual([space]);
    await expect(
      asSystem(prisma).spaceMember.count({ where: { spaceId: space, userId: cy } }),
    ).resolves.toBe(0);
    await expect(
      asSystem(prisma).bot.findUniqueOrThrow({ where: { id: botId }, select: { userId: true } }),
    ).resolves.toEqual({ userId: account });
  });

  it("names people as authors and never the shared account", async () => {
    const authors = await loadMessageAuthors(asSystem(prisma), [ada, account]);
    expect([...authors.keys()]).toEqual([ada]);
    expect(authors.get(ada)).toEqual({ id: ada, name: "ada" });
  });

  it("stops a deactivated teammate's own work and nobody else's", async () => {
    const fixture = asSystem(prisma);
    await fixture.user.update({ where: { id: cy }, data: { deactivatedAt: new Date() } });
    const queue = async (initiatedByUserId: string | null, trigger: string) => {
      const task = await fixture.task.create({
        data: {
          spaceId: space,
          botId,
          threadId,
          userId: account,
          prompt: trigger,
          status: "queued",
        },
      });
      const run = await fixture.run.create({
        data: {
          spaceId: space,
          botId,
          threadId,
          taskId: task.id,
          userId: account,
          initiatedByUserId,
          status: "queued",
          trigger,
        },
      });
      return run.id;
    };
    const cys = await queue(cy, "user");
    const others = [
      await queue(ada, "user"),
      await queue(null, "routine"),
      await queue(null, "webhook"),
    ];
    await expect(
      cancelDeactivatedAccountRuns(fixture, { notify: async () => undefined }, cy),
    ).resolves.toBe(1);
    const status = async (id: string) =>
      (await fixture.run.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    expect(await status(cys)).toBe("cancelled");
    for (const id of others) expect(await status(id)).toBe("queued");
  });
});
