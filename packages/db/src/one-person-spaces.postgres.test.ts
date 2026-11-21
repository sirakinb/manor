import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapUserSpace, joinOrganization } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { createRepos } from "./repos.js";
import { asSystem, runAsSystem, runAsTenant } from "./row-security.js";
import { IsolationError, requireMembership } from "./scope.js";
import { createSpaceAccount } from "./space-account.js";
import { defaultSpaceForMember } from "./spaces.js";
import { assertSpaceTakesPerson, SpaceHasPersonError } from "./team-space.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE && databaseUrl ? describe : describe.skip;

const env = { signupsEnabled: "true", signupAllowlist: "" };
const bootstrap = (...args: Parameters<typeof bootstrapUserSpace>) =>
  runAsSystem("authentication", () => bootstrapUserSpace(...args));

// Manor: a space without a shared account holds one person. Ada signs up first on a brand's host
// and takes its default space; Bea signs up next and gets a space of her own. Cy joins an
// organization whose default space is a team space and joins it, as team provisioning does.
describePostgres("one person per space without a shared account (PostgreSQL)", () => {
  const suffix = randomUUID();
  const brandId = `one-person-brand-${suffix}`;
  const organization = `one-person-org-${suffix}`;
  const defaultSpace = `one-person-space-${suffix}`;
  const teamOrganization = `one-person-team-org-${suffix}`;
  const teamSpace = `one-person-team-space-${suffix}`;
  const ada = `one-person-ada-${suffix}`;
  const bea = `one-person-bea-${suffix}`;
  const cy = `one-person-cy-${suffix}`;
  let client: PrismaClient;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let beaSpace = "";
  let adaBot = "";

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    client = db.prisma;
    prisma = asSystem(db.prisma);
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const now = new Date();
    for (const id of [ada, bea, cy]) {
      await prisma.user.create({
        data: { id, name: id.split("-")[2]!, email: `${id}@example.test`, emailVerified: true },
      });
    }
    await prisma.organization.create({
      data: { id: organization, name: "Client", slug: organization, brandId, createdAt: now },
    });
    await prisma.space.create({
      data: { id: defaultSpace, organizationId: organization, name: "Client", isDefault: true },
    });
    await prisma.organization.create({
      data: { id: teamOrganization, name: "Team", slug: teamOrganization, createdAt: now },
    });
    await prisma.space.create({
      data: { id: teamSpace, organizationId: teamOrganization, name: "Team", isDefault: true },
    });
    await runAsSystem("test fixture", () =>
      client.$transaction((tx) =>
        createSpaceAccount(tx, { id: teamSpace, organizationId: teamOrganization, name: "Team" }),
      ),
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.space.deleteMany({
      where: { organizationId: { in: [organization, teamOrganization] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [organization, teamOrganization] } },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: [ada, bea, cy] } },
          { email: { endsWith: "@space.invalid" }, name: "Team" },
        ],
      },
    });
    await close();
  });

  it("gives the first person the brand's empty default space", async () => {
    await expect(bootstrap(client, { id: ada }, env, { brandId })).resolves.toEqual({
      spaceId: defaultSpace,
      organizationId: organization,
    });
    const bot = await prisma.bot.create({
      data: {
        spaceId: defaultSpace,
        userId: ada,
        name: "Leasing",
        color: "#8B5CF6",
        thread: { create: { spaceId: defaultSpace, userId: ada } },
      },
    });
    adaBot = bot.id;
  });

  it("gives the next person a space of their own, their default in that organization", async () => {
    const joined = await bootstrap(client, { id: bea }, env, { brandId });
    beaSpace = joined.spaceId;
    expect(joined.organizationId).toBe(organization);
    expect(beaSpace).not.toBe(defaultSpace);
    await expect(
      prisma.space.findUniqueOrThrow({ where: { id: beaSpace } }),
    ).resolves.toMatchObject({
      organizationId: organization,
      // The organization keeps one default space (the first person's); this one is Bea's default
      // through defaultSpaceForMember.
      isDefault: false,
      accountUserId: null,
    });
    await expect(
      defaultSpaceForMember(prisma, { userId: bea, organizationId: organization }),
    ).resolves.toBe(beaSpace);
    await expect(
      defaultSpaceForMember(prisma, { userId: ada, organizationId: organization }),
    ).resolves.toBe(defaultSpace);
    await expect(
      prisma.spaceMember.findMany({ where: { spaceId: beaSpace }, select: { userId: true } }),
    ).resolves.toEqual([{ userId: bea }]);
    await expect(
      prisma.spaceMember.count({ where: { spaceId: defaultSpace, userId: bea } }),
    ).resolves.toBe(0);
    await expect(
      prisma.memoryDocument.count({ where: { spaceId: beaSpace, userId: bea } }),
    ).resolves.toBe(1);
  });

  it("keeps the first person's bots and chats out of the next person's reach", async () => {
    await expect(requireMembership(client, bea, defaultSpace)).rejects.toBeInstanceOf(
      IsolationError,
    );
    const actor = await requireMembership(client, bea, beaSpace);
    const repos = createRepos(client);
    const as = <T>(fn: () => Promise<T>) => runAsTenant({ spaceId: beaSpace, userId: bea }, fn);
    expect((await as(() => repos.listBots(actor))).map((bot) => bot.id)).not.toContain(adaBot);
    await expect(as(() => repos.getBot(actor, adaBot))).rejects.toBeInstanceOf(IsolationError);
    await expect(
      assertSpaceTakesPerson(prisma, { spaceId: defaultSpace, userId: bea }),
    ).rejects.toBeInstanceOf(SpaceHasPersonError);
  });

  it("recreates a person's own space when they lost their membership", async () => {
    await prisma.spaceMember.deleteMany({ where: { spaceId: beaSpace, userId: bea } });
    await expect(bootstrap(client, { id: bea }, env)).resolves.toEqual({
      spaceId: beaSpace,
      organizationId: organization,
    });
    await expect(prisma.member.count({ where: { userId: bea } })).resolves.toBe(1);
  });

  it("joins a team space's organization through its team space, as provisioning does", async () => {
    await runAsSystem("operator portal provisioning", () =>
      joinOrganization(client, { id: cy }, { id: teamOrganization, defaultSpaceId: teamSpace }),
    );
    await expect(
      prisma.spaceMember.findMany({
        where: { organizationId: teamOrganization, userId: cy },
        select: { spaceId: true },
      }),
    ).resolves.toEqual([{ spaceId: teamSpace }]);
  });
});
