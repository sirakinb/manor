import { randomBytes } from "node:crypto";
import { signupPolicyFromEnv } from "@rakazo/core";
import type { PrismaClient } from "./client.js";

export interface SignupPolicyEnv {
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

/** Prisma unique-constraint violation; anything else must still throw. */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/** The memory file and notification row every space member starts with. */
async function seedSpaceDefaults(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string },
): Promise<void> {
  const hasMemory = await prisma.memoryDocument.findFirst({
    where: { spaceId: input.spaceId, userId: input.userId, scope: "user", path: "MEMORY.md" },
  });
  if (!hasMemory) {
    await prisma.memoryDocument
      .create({
        data: {
          spaceId: input.spaceId,
          userId: input.userId,
          scope: "user",
          path: "MEMORY.md",
          content: "# Space memory\n\nPreferences and context kept within this space live here.\n",
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
  }
  await prisma.notificationPreference.upsert({
    where: { spaceId_userId: input },
    create: input,
    update: {},
  });
}

/** The organization that owns a brand's client team, with its default space. */
export async function findBrandOrganization(
  prisma: Pick<PrismaClient, "organization">,
  brandId: string,
): Promise<{ id: string; defaultSpaceId: string } | null> {
  const organization = await prisma.organization.findUnique({
    where: { brandId },
    select: {
      id: true,
      spaces: {
        where: { isDefault: true },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  const defaultSpace = organization?.spaces[0];
  return organization && defaultSpace
    ? { id: organization.id, defaultSpaceId: defaultSpace.id }
    : null;
}

/**
 * Add a new user to an existing organization as a plain member of its default
 * space. No organization or space is created, and the deployment-owner seat is
 * never claimed: a client's staffer must not become the deployment owner.
 * Idempotent, like bootstrapUserSpace.
 */
export async function joinOrganization(
  prisma: PrismaClient,
  user: { id: string },
  organization: { id: string; defaultSpaceId: string },
): Promise<{ spaceId: string; organizationId: string }> {
  await prisma.member
    .create({
      data: {
        id: newId(),
        organizationId: organization.id,
        userId: user.id,
        role: "member",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await prisma.spaceMember
    .upsert({
      where: { spaceId_userId: { spaceId: organization.defaultSpaceId, userId: user.id } },
      update: {},
      create: {
        id: newId(),
        spaceId: organization.defaultSpaceId,
        organizationId: organization.id,
        userId: user.id,
        role: "member",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  const space = await prisma.space.findUniqueOrThrow({
    where: { id: organization.defaultSpaceId },
    select: { accountUserId: true },
  });
  await seedSpaceDefaults(prisma, {
    spaceId: organization.defaultSpaceId,
    userId: space.accountUserId ?? user.id,
  });
  return { spaceId: organization.defaultSpaceId, organizationId: organization.id };
}

/**
 * Everything a brand-new user needs around their account row: a personal
 * organization, its default space, owner memberships for both boundaries,
 * deployment-owner claim, user memory, and notification preferences. Shared by
 * the Better Auth `user.create.after` hook and phone-identity provisioning so
 * both paths stay in lockstep.
 *
 * `brandId` is the white-label brand the sign-up arrived on. When an
 * organization claims that brand, the user joins it instead of getting a
 * personal organization; otherwise (default brand, or no claimant) the
 * personal bootstrap below runs as before.
 *
 * `claimDeploymentOwner: false` is for identities that did not sign up
 * through the app (phone provisioning): a first texter must never become
 * the deployment owner.
 */
export async function bootstrapUserSpace(
  prisma: PrismaClient,
  user: { id: string },
  env: SignupPolicyEnv,
  options: { claimDeploymentOwner?: boolean; brandId?: string | null } = {},
): Promise<{ spaceId: string; organizationId: string }> {
  if (options.brandId) {
    const organization = await findBrandOrganization(prisma, options.brandId);
    if (organization) return joinOrganization(prisma, user, organization);
  }
  const claimDeploymentOwner = options.claimDeploymentOwner ?? true;
  // Concurrent bootstraps for the same user (e.g. overlapping first phone
  // inbounds) race on every unique key below; each step either wins or
  // joins the winner's state instead of failing.
  const slug = `user-${user.id.slice(0, 12)}`;
  let orgId = newId();
  try {
    await prisma.organization.create({
      data: { id: orgId, name: "Personal", slug, createdAt: new Date() },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    orgId = (await prisma.organization.findUniqueOrThrow({ where: { slug } })).id;
  }
  await prisma.member
    .create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await prisma.space
    .create({
      data: {
        id: orgId,
        organizationId: orgId,
        name: "Personal",
        isDefault: true,
        createdByUserId: user.id,
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await prisma.spaceMember
    .create({
      data: {
        id: newId(),
        spaceId: orgId,
        organizationId: orgId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  const policy = signupPolicyFromEnv(env);
  await prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      ownerUserId: claimDeploymentOwner ? user.id : null,
      signupsEnabled: policy.enabled,
      signupAllowlist: policy.allowlist.join(","),
      signupPolicyInitialized: true,
    },
    update: {},
  });
  if (claimDeploymentOwner) {
    // Conditional claim: only the first concurrent claimant wins the seat.
    await prisma.deploymentSettings.updateMany({
      where: { id: "default", ownerUserId: null },
      data: { ownerUserId: user.id },
    });
  }
  await seedSpaceDefaults(prisma, { spaceId: orgId, userId: user.id });
  return { spaceId: orgId, organizationId: orgId };
}
