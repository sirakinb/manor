import { describe, expect, it, vi } from "vitest";
import { bootstrapUserSpace, createOrganizationWithDefaultSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";

function makePrisma(settings: { id: string; ownerUserId: string | null } | null) {
  const create = () => vi.fn(async (_input: { data: Record<string, unknown> }) => ({}));
  const prisma = {
    organization: {
      create: create(),
      findUniqueOrThrow: vi.fn(async () => {
        throw new Error("not found");
      }),
    },
    // Manor: not yet in any organization, so the personal bootstrap runs.
    member: { create: create(), findFirst: vi.fn(async () => null) },
    space: { create: create() },
    spaceMember: { create: create() },
    deploymentSettings: {
      findUnique: vi.fn(async () => settings),
      create: create(),
      update: create(),
      upsert: vi.fn(
        async (_input: { create: Record<string, unknown>; update: Record<string, unknown> }) =>
          settings ?? { id: "default" },
      ),
      updateMany: vi.fn(async () => ({ count: settings && !settings.ownerUserId ? 1 : 0 })),
    },
    memoryDocument: { findFirst: vi.fn(async () => null), create: create() },
    notificationPreference: {
      upsert: vi.fn(async (_input: { create: Record<string, unknown> }) => ({})),
    },
  };
  return prisma;
}

describe("bootstrapUserSpace", () => {
  it("creates a personal organization with a default workspace", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: "user-1" });
    const result = await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" });

    expect(prisma.organization.create).toHaveBeenCalledTimes(1);
    const orgData = prisma.organization.create.mock.calls[0]![0].data;
    expect(orgData.name).toBe("Personal");
    expect(orgData.slug).toBe("user-user-1".slice(0, 16));
    expect(result.spaceId).toBe(orgData.id);

    const memberData = prisma.member.create.mock.calls[0]![0].data;
    expect(memberData.organizationId).toBe(orgData.id);
    expect(memberData.userId).toBe("user-1");
    expect(memberData.role).toBe("owner");

    const spaceData = prisma.space.create.mock.calls[0]![0].data;
    expect(spaceData).toEqual(
      expect.objectContaining({
        id: orgData.id,
        organizationId: orgData.id,
        name: "Personal",
      }),
    );
    const spaceMemberData = prisma.spaceMember.create.mock.calls[0]![0].data;
    expect(spaceMemberData).toEqual(
      expect.objectContaining({
        spaceId: orgData.id,
        organizationId: orgData.id,
        userId: "user-1",
      }),
    );
  });

  it("seeds deployment settings with the first sign-up as owner when none exist", async () => {
    const prisma = makePrisma(null);
    await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" });

    const { create, update } = prisma.deploymentSettings.upsert.mock.calls[0]![0];
    // Manor: the signup policy is read from the environment only; nothing else is seeded.
    expect(create).toEqual({ id: "default", ownerUserId: "user-1" });
    expect(update).toEqual({});
  });

  it("claims the deployment owner when settings exist without one", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: null });
    await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" });

    // Conditional claim: the database predicate decides, so a concurrent
    // claimant that already holds the seat is never overwritten.
    expect(prisma.deploymentSettings.updateMany).toHaveBeenCalledWith({
      where: { id: "default", ownerUserId: null },
      data: { ownerUserId: "user-1" },
    });
  });

  it("leaves existing owned settings untouched", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: "user-0" });
    await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" });

    const { update } = prisma.deploymentSettings.upsert.mock.calls[0]![0];
    expect(update).toEqual({});
    // The only owner write is the conditional claim, which excludes rows
    // that already have an owner.
    expect(prisma.deploymentSettings.updateMany).toHaveBeenCalledWith({
      where: { id: "default", ownerUserId: null },
      data: { ownerUserId: "user-1" },
    });
  });

  it("never claims deployment ownership when claimDeploymentOwner is false", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: null });
    await bootstrapUserSpace(
      prisma as unknown as PrismaClient,
      { id: "user-1" },
      {
        claimDeploymentOwner: false,
      },
    );

    expect(prisma.deploymentSettings.updateMany).not.toHaveBeenCalled();
  });

  it("seeds settings without an owner when claimDeploymentOwner is false", async () => {
    const prisma = makePrisma(null);
    await bootstrapUserSpace(
      prisma as unknown as PrismaClient,
      { id: "user-1" },
      {
        claimDeploymentOwner: false,
      },
    );

    const { create } = prisma.deploymentSettings.upsert.mock.calls[0]![0];
    expect(create.ownerUserId).toBeNull();
  });

  it("creates the user memory document and notification preference in the new workspace", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: "user-1" });
    const { spaceId } = await bootstrapUserSpace(prisma as unknown as PrismaClient, {
      id: "user-1",
    });

    const memoryData = prisma.memoryDocument.create.mock.calls[0]![0].data;
    expect(memoryData.spaceId).toBe(spaceId);
    expect(memoryData.userId).toBe("user-1");
    expect(memoryData.scope).toBe("user");
    expect(memoryData.path).toBe("MEMORY.md");

    const prefData = prisma.notificationPreference.upsert.mock.calls[0]![0].create;
    expect(prefData.spaceId).toBe(spaceId);
    expect(prefData.userId).toBe("user-1");
  });
});

describe("bootstrapUserSpace concurrency", () => {
  it("recovers when a concurrent bootstrap wins the org, member, and settings races", async () => {
    const uniqueViolation = async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    };
    const prisma = {
      organization: {
        create: vi.fn(uniqueViolation),
        findUniqueOrThrow: vi.fn(async () => ({ id: "org-winner" })),
      },
      member: { create: vi.fn(uniqueViolation), findFirst: vi.fn(async () => null) },
      space: { create: vi.fn(uniqueViolation) },
      spaceMember: { create: vi.fn(uniqueViolation) },
      deploymentSettings: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(uniqueViolation),
        upsert: vi.fn(async () => ({ id: "default" })),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      memoryDocument: {
        findFirst: vi.fn(async () => ({ id: "mem-1" })),
        create: vi.fn(async () => ({})),
      },
      notificationPreference: { upsert: vi.fn(async () => ({})) },
    };
    const result = await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" });

    expect(result.spaceId).toBe("org-winner");
  });
});

describe("createOrganizationWithDefaultSpace", () => {
  it("names the default Space after the organization and gives it the organization's id", async () => {
    const prisma = makePrisma(null);
    const id = await createOrganizationWithDefaultSpace(prisma as unknown as PrismaClient, {
      userId: "user-1",
      orgId: "org-work",
      name: "Work",
      slug: "org-random",
    });

    expect(id).toBe("org-work");
    expect(prisma.organization.create.mock.calls[0]![0].data).toMatchObject({
      id: "org-work",
      name: "Work",
      slug: "org-random",
    });
    expect(prisma.space.create.mock.calls[0]![0].data).toMatchObject({
      id: "org-work",
      organizationId: "org-work",
      name: "Work",
      isDefault: true,
    });
    expect(prisma.memoryDocument.create).toHaveBeenCalledOnce();
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledOnce();
    expect(prisma.deploymentSettings.upsert).not.toHaveBeenCalled();
  });
});
