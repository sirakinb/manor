import { createDb, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspaceTeam } from "./workspace-team.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("workspace team (PostgreSQL)", () => {
  const stamp = `team-${process.pid}-${Date.now()}`;
  const organizationId = `${stamp}-org`;
  const spaceId = `${stamp}-space`;
  const userId = `${stamp}-owner`;
  const peerId = `${stamp}-peer`;
  const actor = { organizationId, spaceId, userId, email: `${userId}@example.test` };
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let team: ReturnType<typeof createWorkspaceTeam>;
  let defaultId: string;
  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
    team = createWorkspaceTeam(prisma);
    await prisma.organization.create({
      data: {
        id: organizationId,
        slug: organizationId,
        name: "Sample organization",
        createdAt: new Date(),
      },
    });
    await prisma.space.create({ data: { id: spaceId, organizationId, name: "Sample space" } });
    for (const id of [userId, peerId]) {
      await prisma.user.create({
        data: { id, name: "Sample member", email: `${id}@example.test` },
      });
      await prisma.member.create({
        data: {
          id: `${id}-member`,
          organizationId,
          userId: id,
          role: "owner",
          createdAt: new Date(),
        },
      });
      await prisma.spaceMember.create({
        data: {
          id: `${id}-space-member`,
          organizationId,
          spaceId,
          userId: id,
          role: "owner",
          createdAt: new Date(),
        },
      });
    }
    await prisma.workspace.create({
      data: { organizationId, slug: stamp, name: "Sample workspace" },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, peerId] } } });
    await close();
  });
  it("creates one accessible bot for simultaneous first opens without sending a message", async () => {
    expect(await team.list(actor)).toEqual([]);
    const bots = await Promise.all([team.open(actor), team.open(actor)]);
    defaultId = bots[0]!.id;
    expect(bots[1]!.id).toBe(defaultId);
    expect(await prisma.bot.count({ where: { spaceId, userId } })).toBe(1);
    expect(await prisma.run.count({ where: { spaceId, userId } })).toBe(0);
  });
  it("opens the chosen bot and rejects a peer's bot and forged membership", async () => {
    const second = await prisma.bot.create({
      data: {
        spaceId,
        userId,
        name: "Second bot",
        color: "#123456",
        thread: { create: { spaceId, userId } },
      },
    });
    const foreign = await prisma.bot.create({
      data: {
        spaceId,
        userId: peerId,
        name: "Peer bot",
        color: "#123456",
        thread: { create: { spaceId, userId: peerId } },
      },
    });
    expect((await team.open(actor, second.id)).id).toBe(second.id);
    await expect(team.open(actor, foreign.id)).rejects.toThrow();
    await expect(team.list({ ...actor, userId: "missing-member" })).rejects.toThrow();
    await expect(team.list({ ...actor, organizationId: "forged-org" })).rejects.toThrow();
    await prisma.bot.delete({ where: { id: second.id } });
  });
  it("does not restore an archived default or silently create duplicates", async () => {
    await prisma.bot.update({ where: { id: defaultId }, data: { archivedAt: new Date() } });
    await expect(team.open(actor)).rejects.toThrow("Restore your archived workspace assistant");
    expect(await prisma.bot.count({ where: { spaceId, userId } })).toBe(1);
    expect(await team.list(actor)).toEqual([]);
  });
});
