import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { ORGANIZATION_CHANGES_AVAILABLE } from "./organization-availability.js";

/**
 * The other Space holding one of the caller's own bots, among the Spaces they belong to. Manor:
 * only within the organization this session may act in, since a Space in another organization
 * is reached through its own portal, not by switching.
 */
export function otherSpaceOfBot(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
  organizationChangesAvailable = ORGANIZATION_CHANGES_AVAILABLE,
): Promise<string | undefined> {
  const organization = organizationChangesAvailable
    ? {}
    : { organizationId: actor.portalOrganizationId ?? actor.organizationId };
  return runAsSystem("find which of the caller's Spaces holds their bot", async () => {
    const bot = await prisma.bot.findFirst({
      where: {
        id: botId,
        userId: actor.userId,
        archivedAt: null,
        spaceId: { not: actor.spaceId },
        space: {
          deletingAt: null,
          ...organization,
          memberships: { some: { userId: actor.userId } },
        },
      },
      select: { spaceId: true },
    });
    return bot?.spaceId;
  });
}
