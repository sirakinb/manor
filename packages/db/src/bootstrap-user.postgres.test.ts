import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapUserSpace, findBrandOrganization } from "./account/bootstrap-user.js";
import type { PrismaClient } from "./database/client.js";
import { createDb } from "./database/client.js";
import { asSystem, runAsSystem } from "./database/row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE && databaseUrl ? describe : describe.skip;

// Sign-up bootstrap runs in the auth route's system context.
const bootstrap = (...args: Parameters<typeof bootstrapUserSpace>) =>
  runAsSystem("authentication", () => bootstrapUserSpace(...args));

describePostgres("bootstrapUserSpace with a branded sign-up (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  // A brand id no real brand uses, so the row can never collide with a deployment's own.
  const brandId = `test-brand-${suffix}`;
  const clientOrganizationId = `brand-org-${suffix}`;
  const clientSpaceId = `brand-space-${suffix}`;
  const joiningUserId = `brand-joiner-${suffix}`;
  const personalUserId = `brand-nobody-${suffix}`;
  // The code under test gets the plain client; fixtures and assertions use a system view.
  let client: PrismaClient;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let ownerBefore: string | null | undefined;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    client = db.prisma;
    prisma = asSystem(db.prisma);
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    ownerBefore = (await prisma.deploymentSettings.findUnique({ where: { id: "default" } }))
      ?.ownerUserId;
    for (const id of [joiningUserId, personalUserId]) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@rakazo.test`, emailVerified: false },
      });
    }
    await prisma.organization.create({
      data: {
        id: clientOrganizationId,
        name: "Client Team",
        slug: clientOrganizationId,
        brandId,
        createdAt: new Date(),
      },
    });
    await prisma.space.create({
      data: {
        id: clientSpaceId,
        organizationId: clientOrganizationId,
        name: "Client Team",
        isDefault: true,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    const personal = await prisma.member.findMany({
      where: { userId: personalUserId },
      select: { organizationId: true },
    });
    await prisma.organization.deleteMany({
      where: {
        id: { in: [clientOrganizationId, ...personal.map((row) => row.organizationId)] },
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: [joiningUserId, personalUserId] } } });
    await close();
  });

  it("resolves the organization that claims a brand", async () => {
    await expect(findBrandOrganization(prisma, brandId)).resolves.toEqual({
      id: clientOrganizationId,
      defaultSpaceId: clientSpaceId,
    });
    await expect(findBrandOrganization(prisma, `${brandId}-unclaimed`)).resolves.toBeNull();
  });

  it("joins the brand's organization as a member instead of creating a personal one", async () => {
    const organizationsBefore = await prisma.organization.count();
    const result = await bootstrap(client, { id: joiningUserId }, { brandId });
    expect(result).toEqual({ spaceId: clientSpaceId, organizationId: clientOrganizationId });
    expect(await prisma.organization.count()).toBe(organizationsBefore);

    const members = await prisma.member.findMany({ where: { userId: joiningUserId } });
    expect(members).toEqual([
      expect.objectContaining({ organizationId: clientOrganizationId, role: "member" }),
    ]);
    const spaceMembers = await prisma.spaceMember.findMany({ where: { userId: joiningUserId } });
    expect(spaceMembers).toEqual([
      expect.objectContaining({
        spaceId: clientSpaceId,
        organizationId: clientOrganizationId,
        role: "member",
      }),
    ]);
    // The per-space seeds a member needs, same as a personal bootstrap.
    await expect(
      prisma.memoryDocument.findFirst({
        where: { spaceId: clientSpaceId, userId: joiningUserId, scope: "user", path: "MEMORY.md" },
      }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.notificationPreference.findFirst({
        where: { spaceId: clientSpaceId, userId: joiningUserId },
      }),
    ).resolves.toBeTruthy();
    // A client's staffer never takes the deployment-owner seat.
    const settings = await prisma.deploymentSettings.findUnique({ where: { id: "default" } });
    expect(settings?.ownerUserId ?? null).toBe(ownerBefore ?? null);
  });

  it("is idempotent for a repeated join", async () => {
    await bootstrap(client, { id: joiningUserId }, { brandId });
    expect(await prisma.member.count({ where: { userId: joiningUserId } })).toBe(1);
    expect(await prisma.spaceMember.count({ where: { userId: joiningUserId } })).toBe(1);
  });

  it("lets the requests of one sign-in bootstrap the same person at once", async () => {
    // A sign-in fires several requests together, and each one seeds the person's defaults.
    await prisma.notificationPreference.deleteMany({ where: { userId: joiningUserId } });
    await Promise.all(
      Array.from({ length: 6 }, () => bootstrap(client, { id: joiningUserId }, { brandId })),
    );
    expect(await prisma.spaceMember.count({ where: { userId: joiningUserId } })).toBe(1);
    expect(await prisma.notificationPreference.count({ where: { userId: joiningUserId } })).toBe(1);
  });

  it("falls back to the personal bootstrap when no organization claims the brand", async () => {
    const result = await bootstrap(
      client,
      { id: personalUserId },
      {
        brandId: `${brandId}-unclaimed`,
      },
    );
    expect(result.organizationId).toBe(result.spaceId);
    expect(result.organizationId).not.toBe(clientOrganizationId);
    const organization = await prisma.organization.findUnique({
      where: { id: result.organizationId },
    });
    expect(organization).toMatchObject({ name: "Personal", brandId: null });
    const members = await prisma.member.findMany({ where: { userId: personalUserId } });
    expect(members).toEqual([
      expect.objectContaining({ organizationId: result.organizationId, role: "owner" }),
    ]);
  });
});
