import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../database/client.js";
import { isUniqueViolation } from "../database/prisma-errors.js";
import { runAsSystem } from "../database/row-security.js";
import { assertSpaceTakesPerson } from "../team-space.js";

type OrganizationClient = Pick<
  PrismaClient,
  | "organization"
  | "member"
  | "space"
  | "spaceMember"
  | "spaceInvite"
  | "memoryDocument"
  | "notificationPreference"
>;

function newId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * The memory file and notification row every space member starts with. Memory is a protected
 * table, so seeding runs as a named system step here, in one place, whichever path reaches it (the
 * session hook, the owner CLI, provisioning). Inside a caller's transaction (a client without
 * `$transaction`) the caller's context already applies.
 */
async function seedSpaceDefaults(
  prisma: Pick<OrganizationClient, "memoryDocument" | "notificationPreference">,
  input: { spaceId: string; userId: string },
): Promise<void> {
  const seed = async () => {
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
            content:
              "# Space memory\n\nPreferences and context kept within this space live here.\n",
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
  };
  if ("$transaction" in prisma) await runAsSystem("seed a space member's defaults", seed);
  else await seed();
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
 * Add a user to an existing organization. Manor: a space without a shared account holds one
 * person, so they join the organization's default space only when it is a team space (a shared
 * account); otherwise they get a space of their own there (`ensureOwnSpace`). No organization is
 * created, and the deployment-owner seat is never claimed: a client's staffer must not become the
 * deployment owner. Idempotent, like bootstrapUserSpace.
 */
export async function joinOrganization(
  prisma: PrismaClient,
  user: { id: string },
  organization: { id: string; defaultSpaceId: string },
): Promise<{ spaceId: string; organizationId: string }> {
  // The membership trigger adds the person to the organization's team spaces. Skipping a
  // duplicate, rather than catching it, keeps a caller's transaction usable.
  await prisma.member.createMany({
    data: [
      {
        id: newId(),
        organizationId: organization.id,
        userId: user.id,
        role: "member",
        createdAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
  const space = await prisma.space.findUniqueOrThrow({
    where: { id: organization.defaultSpaceId },
    select: { accountUserId: true },
  });
  if (!space.accountUserId) {
    const spaceId = await ensureOwnSpace(prisma, user, organization.id);
    return { spaceId, organizationId: organization.id };
  }
  await assertSpaceTakesPerson(prisma, { spaceId: organization.defaultSpaceId, userId: user.id });
  await prisma.spaceMember.createMany({
    data: [
      {
        id: newId(),
        spaceId: organization.defaultSpaceId,
        organizationId: organization.id,
        userId: user.id,
        role: "member",
        createdAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
  await seedSpaceDefaults(prisma, {
    spaceId: organization.defaultSpaceId,
    userId: space.accountUserId,
  });
  return { spaceId: organization.defaultSpaceId, organizationId: organization.id };
}

/**
 * Manor: the person's space in this organization. An existing membership there (their own space,
 * or a team space) is theirs already; otherwise a space of their own is created and seeded like
 * every personal space. Its id is derived from the organization and the person, so concurrent
 * first sessions converge on one space. It is not the organization's default space (one per
 * organization, `spaces_organizationId_default_key`); it is the person's default there through
 * `defaultSpaceForMember`. Inserts skip duplicates instead of catching a unique violation, which
 * would abort a caller's transaction.
 */
export async function ensureOwnSpace(
  prisma: OrganizationClient,
  user: { id: string },
  organizationId: string,
): Promise<string> {
  const existing = await prisma.spaceMember.findFirst({
    where: { organizationId, userId: user.id, space: { deletingAt: null } },
    orderBy: [{ space: { isDefault: "desc" } }, { createdAt: "asc" }, { id: "asc" }],
    select: { spaceId: true },
  });
  if (existing) {
    // The first person in an organization joins its empty default space through the membership
    // trigger, which seeds nothing; their memory file and notification row start here. A team
    // space's defaults belong to its shared account and were seeded with it.
    const space = await prisma.space.findUniqueOrThrow({
      where: { id: existing.spaceId },
      select: { accountUserId: true },
    });
    if (!space.accountUserId)
      await seedSpaceDefaults(prisma, { spaceId: existing.spaceId, userId: user.id });
    return existing.spaceId;
  }
  const spaceId = createHash("sha256")
    .update(`own-space:${organizationId}:${user.id}`)
    .digest("hex")
    .slice(0, 32);
  const createdAt = new Date();
  await prisma.space.createMany({
    data: [
      {
        id: spaceId,
        organizationId,
        name: "Personal",
        isDefault: false,
        createdByUserId: user.id,
        createdAt,
      },
    ],
    skipDuplicates: true,
  });
  await prisma.spaceMember.createMany({
    data: [{ id: newId(), spaceId, organizationId, userId: user.id, role: "owner", createdAt }],
    skipDuplicates: true,
  });
  await seedSpaceDefaults(prisma, { spaceId, userId: user.id });
  return spaceId;
}

/**
 * An organization owned by `userId`, with a default Space of the same id and name. Each step
 * joins an existing row instead of failing, so a concurrent call with the same slug converges.
 * Returns the organization's id, which is also its default Space's.
 */
export async function createOrganizationWithDefaultSpace(
  prisma: OrganizationClient,
  input: { userId: string; orgId: string; name: string; slug: string },
): Promise<string> {
  const { userId, name, slug } = input;
  let orgId = input.orgId;
  try {
    await prisma.organization.create({
      data: { id: orgId, name, slug, createdAt: new Date() },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    orgId = (await prisma.organization.findUniqueOrThrow({ where: { slug } })).id;
  }
  // Before the Space, so the trigger joining members to the default Space finds none and the
  // SpaceMember below cannot collide, which would abort a caller's transaction.
  await prisma.member
    .create({
      data: { id: newId(), organizationId: orgId, userId, role: "owner", createdAt: new Date() },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await prisma.space
    .create({
      data: {
        id: orgId,
        organizationId: orgId,
        name,
        isDefault: true,
        createdByUserId: userId,
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
        userId,
        role: "owner",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  // Manor: one seeding path for every Space member; the notification row is an upsert, so a
  // repeat inside a caller's transaction does not abort it.
  await seedSpaceDefaults(prisma, { spaceId: orgId, userId });
  return orgId;
}

/**
 * Everything a brand-new user needs around their account row: a personal
 * organization, its default space, owner memberships for both boundaries,
 * deployment-owner claim, user memory, and notification preferences. Shared by
 * the Better Auth `session.create.before` hook and phone-identity provisioning so
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
  options: { claimDeploymentOwner?: boolean; brandId?: string | null } = {},
): Promise<{ spaceId: string; organizationId: string }> {
  if (options.brandId) {
    const organization = await findBrandOrganization(prisma, options.brandId);
    if (organization) return joinOrganization(prisma, user, organization);
  }
  // Manor: someone already in an organization (whose shared default space they left when spaces
  // became one person each) gets their own space there instead of a new organization.
  const organizationMembership = await prisma.member.findFirst({
    where: { userId: user.id, role: { not: "guest" }, organization: { brandId: { not: null } } },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (organizationMembership) {
    const spaceId = await ensureOwnSpace(prisma, user, organizationMembership.organizationId);
    return { spaceId, organizationId: organizationMembership.organizationId };
  }
  const claimDeploymentOwner = options.claimDeploymentOwner ?? true;
  // Concurrent bootstraps for the same user (e.g. overlapping first phone inbounds) share the slug.
  const spaceId = await createOrganizationWithDefaultSpace(prisma, {
    userId: user.id,
    orgId: newId(),
    name: "Personal",
    slug: `user-${user.id.slice(0, 12)}`,
  });
  await prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: { id: "default", ownerUserId: claimDeploymentOwner ? user.id : null },
    update: {},
  });
  // Manor: the first sign-up claims the deployment-owner seat that maintenance is restricted to.
  if (claimDeploymentOwner) {
    // Conditional claim: only the first concurrent claimant wins the seat.
    await prisma.deploymentSettings.updateMany({
      where: { id: "default", ownerUserId: null },
      data: { ownerUserId: user.id },
    });
  }
  return { spaceId, organizationId: spaceId };
}
