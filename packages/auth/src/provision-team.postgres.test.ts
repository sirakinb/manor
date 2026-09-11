import {
  bootstrapUserSpace,
  createDb,
  createSpaceForMember,
  requireMembership,
  spaceResourceActor,
} from "@rakazo/db";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { afterAll, describe, expect, it } from "vitest";
import { provisionPortalTeam } from "./provision-team.js";

const postgres = process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;
postgres("operator portal provisioning", () => {
  const db = createDb(process.env.DATABASE_URL!);
  const suffix = `${process.pid}-${Date.now()}`;
  const email = `provision-${suffix}@example.test`;
  const existingEmail = `existing-${suffix}@example.test`;
  const foreignEmail = `foreign-${suffix}@example.test`;
  const rollbackEmail = `rollback-${suffix}@example.test`;
  const joiningEmail = `joining-${suffix}@example.test`;
  let spaceAccountId: string | undefined;
  let organizationId: string | undefined;
  let personalOrganizationId: string | undefined;
  afterAll(async () => {
    if (organizationId) await db.prisma.organization.delete({ where: { id: organizationId } });
    if (personalOrganizationId)
      await db.prisma.organization.delete({ where: { id: personalOrganizationId } });
    await db.prisma.user.deleteMany({
      where: {
        OR: [
          { email: { in: [email, existingEmail, foreignEmail, rollbackEmail, joiningEmail] } },
          ...(spaceAccountId ? [{ id: spaceAccountId }] : []),
        ],
      },
    });
    await db.prisma.$disconnect();
    await db.pool.end();
  });
  it("creates isolated membership and a working password, then preserves it on replay", async () => {
    // This test requires an isolated synthetic database, like the E2E harness.
    expect(
      await db.prisma.organization.findUnique({ where: { brandId: "vibecodephilly" } }),
    ).toBeNull();
    const input = { brandId: "vibecodephilly", members: [{ email, name: "Portal Tester" }] };
    const result = await provisionPortalTeam(db.prisma, input);
    organizationId = result.organizationId;
    const space = await db.prisma.space.findUniqueOrThrow({ where: { id: result.spaceId } });
    expect(space.accountUserId).toBeTruthy();
    spaceAccountId = space.accountUserId!;
    expect(await db.prisma.space.count({ where: { organizationId } })).toBe(1);
    expect(result.accounts[0]?.created).toBe(true);
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.portalBrandId).toBe("vibecodephilly");
    const account = await db.prisma.account.findFirstOrThrow({
      where: { userId: user.id, providerId: "credential" },
    });
    expect(
      await verifyPassword({ hash: account.password!, password: result.accounts[0]!.password! }),
    ).toBe(true);
    expect(await db.prisma.spaceMember.count({ where: { userId: user.id, organizationId } })).toBe(
      1,
    );
    const replay = await provisionPortalTeam(db.prisma, input);
    expect(replay.organizationId).toBe(organizationId);
    expect(replay.accounts[0]).toEqual({ email, password: null, created: false });
    expect(
      (await db.prisma.account.findUniqueOrThrow({ where: { id: account.id } })).password,
    ).toBe(account.password);
  });
  it("adds an existing main-portal account without changing its password or original organization", async () => {
    const user = await db.prisma.user.create({
      data: { id: `existing-${suffix}`, email: existingEmail, name: "Existing Tester" },
    });
    const personal = await bootstrapUserSpace(
      db.prisma,
      user,
      { signupsEnabled: "true", signupAllowlist: "" },
      { claimDeploymentOwner: false },
    );
    personalOrganizationId = personal.organizationId;
    const hash = await hashPassword("existing-test-password");
    await db.prisma.account.create({
      data: {
        id: `account-${suffix}`,
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hash,
      },
    });
    const result = await provisionPortalTeam(db.prisma, {
      brandId: "vibecodephilly",
      members: [{ email: existingEmail.toUpperCase(), name: "Ignored rename" }],
    });
    expect(result.accounts[0]).toEqual({ email: existingEmail, password: null, created: false });
    expect(await db.prisma.space.count({ where: { organizationId } })).toBe(1);
    expect(
      await db.prisma.memoryDocument.count({ where: { spaceId: result.spaceId, scope: "user" } }),
    ).toBe(1);
    expect(
      await db.prisma.notificationPreference.count({ where: { spaceId: result.spaceId } }),
    ).toBe(1);
    expect(await db.prisma.member.count({ where: { userId: user.id } })).toBe(2);
    expect(await db.prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({
      name: "Existing Tester",
      portalBrandId: null,
    });
    expect(
      (await db.prisma.account.findUniqueOrThrow({ where: { id: `account-${suffix}` } })).password,
    ).toBe(hash);
  });
  it("joins the same shared account on signup and creates a personal space only on request", async () => {
    const provisioned = await provisionPortalTeam(db.prisma, {
      brandId: "vibecodephilly",
      members: [{ email, name: "Portal Tester" }],
    });
    organizationId = provisioned.organizationId;
    spaceAccountId = (
      await db.prisma.space.findUniqueOrThrow({ where: { id: provisioned.spaceId } })
    ).accountUserId!;
    const user = await db.prisma.user.create({
      data: { id: `joining-${suffix}`, email: joiningEmail, name: "New Teammate" },
    });
    const team = await bootstrapUserSpace(
      db.prisma,
      user,
      { signupsEnabled: "true", signupAllowlist: "" },
      { brandId: "vibecodephilly" },
    );
    const actor = await requireMembership(db.prisma, user.id, team.spaceId);
    expect((await spaceResourceActor(db.prisma, actor)).userId).toBe(spaceAccountId);
    await bootstrapUserSpace(
      db.prisma,
      user,
      { signupsEnabled: "true", signupAllowlist: "" },
      { brandId: "vibecodephilly" },
    );
    expect(await db.prisma.space.count({ where: { organizationId } })).toBe(1);
    expect(await db.prisma.spaceMember.count({ where: { organizationId, userId: user.id } })).toBe(
      1,
    );
    const personal = await createSpaceForMember(db.prisma, {
      currentSpaceId: team.spaceId,
      userId: user.id,
      name: "My private space",
    });
    const privateActor = await requireMembership(db.prisma, user.id, personal.id);
    expect((await spaceResourceActor(db.prisma, privateActor)).userId).toBe(user.id);
    const peer = await db.prisma.user.findUniqueOrThrow({ where: { email } });
    await expect(requireMembership(db.prisma, peer.id, personal.id)).rejects.toThrow(
      "No personal space",
    );
  });
  it("rolls back the batch if an account is restricted to a different client", async () => {
    await db.prisma.user.create({
      data: {
        id: `foreign-${suffix}`,
        email: foreignEmail,
        name: "Other Client",
        portalBrandId: "other-client",
      },
    });
    await expect(
      provisionPortalTeam(db.prisma, {
        brandId: "vibecodephilly",
        members: [
          { email: rollbackEmail, name: "Rolled Back" },
          { email: foreignEmail, name: "Other Client" },
        ],
      }),
    ).rejects.toThrow("another client portal");
    expect(await db.prisma.user.findUnique({ where: { email: rollbackEmail } })).toBeNull();
  });
});
