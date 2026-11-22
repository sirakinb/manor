import { randomUUID } from "node:crypto";
import type { MessageBlock } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../database/client.js";
import { createDb, Prisma } from "../database/client.js";
import { asSystem, runAsTenant } from "../database/row-security.js";
import { authorSpeaksForOwner, createThreadMessage, routineReadableSql } from "./messages.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE && databaseUrl ? describe : describe.skip;

// Manor: in a team space the routine's owner is the shared account, and its person members speak
// for it. Ada and Bea are people in the team space, Gus is a guest of its organization, and Otto
// belongs to another organization. Ada also has a space of her own.
describePostgres("whose messages a routine reads as its owner's (PostgreSQL)", () => {
  const suffix = randomUUID();
  const account = `authors-account-${suffix}`;
  const ada = `authors-ada-${suffix}`;
  const bea = `authors-bea-${suffix}`;
  const gus = `authors-gus-${suffix}`;
  const otto = `authors-otto-${suffix}`;
  const organization = `authors-org-${suffix}`;
  const ottoOrganization = `authors-otto-org-${suffix}`;
  const teamSpace = `authors-team-${suffix}`;
  const adaSpace = `authors-ada-space-${suffix}`;
  const ottoSpace = `authors-otto-space-${suffix}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let teamThread = { threadId: "", botId: "" };
  let ownThread = { threadId: "", botId: "" };
  const posted = new Map<string, string>();

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
    const fixture = asSystem(prisma);
    const now = new Date();
    for (const id of [account, ada, bea, gus, otto]) {
      await fixture.user.create({
        data: {
          id,
          name: id.split("-")[1]!,
          email: `${id}@example.test`,
          emailVerified: true,
          isSpaceAccount: id === account,
        },
      });
    }
    for (const id of [organization, ottoOrganization]) {
      await fixture.organization.create({
        data: { id, name: "Authors", slug: id, createdAt: now },
      });
    }
    await fixture.space.createMany({
      data: [
        { id: teamSpace, organizationId: organization, name: "Team", accountUserId: account },
        { id: adaSpace, organizationId: organization, name: "Ada" },
        { id: ottoSpace, organizationId: ottoOrganization, name: "Otto" },
      ],
    });
    const members = [
      [organization, account, "service"],
      [organization, ada, "owner"],
      [organization, bea, "member"],
      [organization, gus, "guest"],
      [ottoOrganization, otto, "owner"],
    ] as const;
    for (const [organizationId, userId, role] of members) {
      await fixture.member.create({
        data: { id: randomUUID(), organizationId, userId, role, createdAt: now },
      });
    }
    // The membership trigger may already have added people to the team space.
    await fixture.spaceMember.createMany({
      data: [
        [teamSpace, organization, account],
        [teamSpace, organization, ada],
        [teamSpace, organization, bea],
        [teamSpace, organization, gus],
        [adaSpace, organization, ada],
        [ottoSpace, ottoOrganization, otto],
      ].map(([spaceId, organizationId, userId]) => ({
        id: randomUUID(),
        spaceId: spaceId!,
        organizationId: organizationId!,
        userId: userId!,
        role: "member",
        createdAt: now,
      })),
      skipDuplicates: true,
    });
    for (const [spaceId, owner, target] of [
      [teamSpace, account, "team"],
      [adaSpace, ada, "own"],
    ] as const) {
      const bot = await fixture.bot.create({
        data: {
          spaceId,
          userId: owner,
          name: "Planner",
          color: "blue",
          thread: { create: { spaceId, userId: owner } },
        },
        include: { thread: true },
      });
      const ids = { threadId: bot.thread!.id, botId: bot.id };
      if (target === "team") teamThread = ids;
      else ownThread = ids;
    }

    const text = (value: string): MessageBlock[] => [{ kind: "text", text: value }];
    // Each chat's owner writes the rows; the author stamp is what the rule reads.
    const post = (
      key: string,
      spaceId: string,
      threadId: string,
      author: string,
      blocks = text(key),
    ) =>
      runAsTenant({ spaceId, userId: spaceId === teamSpace ? account : ada }, async () => {
        const message = await createThreadMessage(prisma, {
          threadId,
          role: "user",
          blocks,
          authorUserId: author,
        });
        posted.set(key, message.id);
      });
    await post("team-ada", teamSpace, teamThread.threadId, ada);
    await post("team-bea", teamSpace, teamThread.threadId, bea);
    await post("team-gus", teamSpace, teamThread.threadId, gus);
    await post("team-otto", teamSpace, teamThread.threadId, otto);
    await post("team-channel", teamSpace, teamThread.threadId, ada, [
      {
        kind: "channel_message",
        provider: "slack",
        channelId: randomUUID(),
        fromAddress: "U1",
        fromLabel: "Someone",
        text: "From the channel",
      },
    ]);
    await post("own-ada", adaSpace, ownThread.threadId, ada);
    await post("own-bea", adaSpace, ownThread.threadId, bea);
  });

  afterAll(async () => {
    if (!prisma) return;
    const fixture = asSystem(prisma);
    await fixture.space.deleteMany({ where: { id: { in: [teamSpace, adaSpace, ottoSpace] } } });
    await fixture.organization.deleteMany({
      where: { id: { in: [organization, ottoOrganization] } },
    });
    await fixture.user.deleteMany({ where: { id: { in: [account, ada, bea, gus, otto] } } });
    await close();
  });

  async function readable(thread: { threadId: string; botId: string }, ownerId: string) {
    const rows = await asSystem(prisma).$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT m.id FROM messages m
      WHERE m."threadId" = ${thread.threadId} AND ${routineReadableSql(ownerId, thread.botId)}`);
    const ids = new Set(rows.map((row) => row.id));
    return [...posted].filter(([, id]) => ids.has(id)).map(([key]) => key);
  }

  it("reads a team space member's message, not a guest's, another organization's or a channel's", async () => {
    await expect(readable(teamThread, account)).resolves.toEqual(["team-ada", "team-bea"]);
  });

  it("reads only the owner's message in a space without a shared account", async () => {
    await expect(readable(ownThread, ada)).resolves.toEqual(["own-ada"]);
  });

  it("answers the same in JavaScript", async () => {
    const speaks = (spaceId: string, ownerUserId: string, authorUserId: string | null) =>
      authorSpeaksForOwner(asSystem(prisma), { spaceId, ownerUserId, authorUserId });
    await expect(speaks(teamSpace, account, ada)).resolves.toBe(true);
    await expect(speaks(teamSpace, account, account)).resolves.toBe(true);
    await expect(speaks(teamSpace, account, gus)).resolves.toBe(false);
    await expect(speaks(teamSpace, account, otto)).resolves.toBe(false);
    await expect(speaks(teamSpace, account, null)).resolves.toBe(false);
    await expect(speaks(adaSpace, ada, ada)).resolves.toBe(true);
    await expect(speaks(adaSpace, ada, bea)).resolves.toBe(false);
  });
});
