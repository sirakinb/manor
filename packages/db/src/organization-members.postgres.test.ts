import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  acceptOrganizationInvitation,
  listOrganizationMembers,
  revokeOrganizationMember,
  SpaceAccountUnmanageableError,
  setOrganizationMemberRole,
} from "./organization-members.js";
import { asSystem, runAsSystem } from "./row-security.js";
import { createSpaceAccount } from "./space-account.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE && databaseUrl ? describe : describe.skip;

// Manor: upstream's organization invitations and member management are off, but keep Manor's
// guards. An organization whose default space is a team space (a shared account): an invitee keeps
// the team space the membership trigger adds them to, and the shared account is never listed,
// given another role or removed.
describePostgres("organization members around a team space (PostgreSQL)", () => {
  const suffix = randomUUID();
  const organization = `org-members-org-${suffix}`;
  const teamSpace = `org-members-team-${suffix}`;
  const ada = `org-members-ada-${suffix}`;
  const cy = `org-members-cy-${suffix}`;
  let client: PrismaClient;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let account = "";

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    client = db.prisma;
    prisma = asSystem(db.prisma);
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const now = new Date();
    for (const id of [ada, cy]) {
      await prisma.user.create({
        data: { id, name: id.split("-")[2]!, email: `${id}@example.test`, emailVerified: true },
      });
    }
    await prisma.organization.create({
      data: { id: organization, name: "Team", slug: organization, createdAt: now },
    });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: organization,
        userId: ada,
        role: "owner",
        createdAt: now,
      },
    });
    await prisma.space.create({
      data: { id: teamSpace, organizationId: organization, name: "Team", isDefault: true },
    });
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: teamSpace, userId: ada } },
      create: {
        id: randomUUID(),
        spaceId: teamSpace,
        organizationId: organization,
        userId: ada,
        role: "owner",
        createdAt: now,
      },
      update: {},
    });
    account = await runAsSystem("test fixture", () =>
      client.$transaction((tx) =>
        createSpaceAccount(tx, { id: teamSpace, organizationId: organization, name: "Team" }),
      ),
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.space.deleteMany({ where: { organizationId: organization } });
    await prisma.organization.deleteMany({ where: { id: organization } });
    await prisma.user.deleteMany({ where: { id: { in: [ada, cy, account] } } });
    await close();
  });

  it("keeps an invitee in the team default space and gives them a space of their own", async () => {
    const invitationId = `org-members-invite-${suffix}`;
    await prisma.invitation.create({
      data: {
        id: invitationId,
        organizationId: organization,
        email: `${cy}@example.test`,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
        inviterId: ada,
      },
    });
    const joined = await acceptOrganizationInvitation(prisma, {
      invitationId,
      userId: cy,
      requireVerifiedEmail: false,
    });
    expect(joined.organizationId).toBe(organization);
    expect(joined.spaceId).not.toBe(teamSpace);
    const spaces = await prisma.spaceMember.findMany({
      where: { organizationId: organization, userId: cy },
      select: { spaceId: true },
    });
    expect(spaces.map((row) => row.spaceId).sort()).toEqual([joined.spaceId, teamSpace].sort());
    await expect(prisma.spaceMember.count({ where: { spaceId: joined.spaceId } })).resolves.toBe(1);
  });

  it("never lists the shared account as a member", async () => {
    const { members } = await listOrganizationMembers(prisma, {
      organizationId: organization,
      userId: ada,
    });
    expect(members.map((member) => member.userId)).toContain(ada);
    expect(members.map((member) => member.userId)).not.toContain(account);
  });

  it("refuses to change the shared account's role or remove it", async () => {
    await expect(
      setOrganizationMemberRole(prisma, {
        organizationId: organization,
        userId: ada,
        memberUserId: account,
        role: "admin",
      }),
    ).rejects.toBeInstanceOf(SpaceAccountUnmanageableError);
    await expect(
      revokeOrganizationMember(prisma, {
        organizationId: organization,
        userId: ada,
        memberUserId: account,
      }),
    ).rejects.toBeInstanceOf(SpaceAccountUnmanageableError);
    await expect(
      prisma.member.findFirst({
        where: { organizationId: organization, userId: account },
        select: { role: true },
      }),
    ).resolves.toEqual({ role: "service" });
  });
});
