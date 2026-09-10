import { createDb } from "@rakazo/db";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, describe, expect, it } from "vitest";
import { provisionPortalTeam } from "./provision-team.js";

const postgres = process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe : describe.skip;
postgres("operator portal provisioning", () => {
  const db = createDb(process.env.DATABASE_URL!);
  const suffix = `${process.pid}-${Date.now()}`;
  const email = `provision-${suffix}@example.test`;
  let organizationId: string | undefined;
  afterAll(async () => {
    if (organizationId) await db.prisma.organization.delete({ where: { id: organizationId } });
    await db.prisma.user.deleteMany({ where: { email } });
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
});
