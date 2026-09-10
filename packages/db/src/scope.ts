import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";

/** Only the organization matters for account-wide data (CRM, Workspace), so agent runs can act without a full Actor. */
export type OrganizationScope = Pick<Actor, "organizationId">;

export class IsolationError extends Error {
  constructor(message = "Resource not found") {
    super(message);
    this.name = "IsolationError";
  }
}

export async function requireMembership(
  prisma: PrismaClient,
  userId: string,
  requestedSpaceId?: string | null,
  portalOrganizationId?: string | null,
): Promise<Actor> {
  const membership = await prisma.spaceMember.findFirst({
    where: {
      userId,
      member: { user: { isSpaceAccount: false } },
      ...(portalOrganizationId ? { organizationId: portalOrganizationId } : {}),
      ...(requestedSpaceId ? { spaceId: requestedSpaceId } : {}),
    },
    orderBy: [{ space: { isDefault: "desc" } }, { createdAt: "asc" }, { id: "asc" }],
    include: { member: { include: { user: true } }, space: { select: { accountUserId: true } } },
  });
  if (!membership) {
    throw new IsolationError("No personal space");
  }
  const settings = await prisma.deploymentSettings.findUnique({
    where: { id: "default" },
  });
  return {
    userId: membership.userId,
    spaceId: membership.spaceId,
    organizationId: membership.organizationId,
    email: membership.member.user.email,
    isDeploymentOwner: settings?.ownerUserId === membership.userId,
    spaceAccountUserId: membership.space.accountUserId ?? undefined,
  };
}

/** The organization a space belongs to. Every crm_ row is scoped by this, not spaceId. */
export async function resolveOrganizationId(
  prisma: Pick<PrismaClient, "space">,
  spaceId: string,
): Promise<string> {
  const space = await prisma.space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { organizationId: true },
  });
  return space.organizationId;
}

export function scoped<T extends { spaceId: string; userId?: string }>(
  actor: Actor,
  record: T | null,
): T {
  if (!record || record.spaceId !== actor.spaceId) {
    throw new IsolationError();
  }
  if (record.userId && record.userId !== actor.userId) {
    throw new IsolationError();
  }
  return record;
}
