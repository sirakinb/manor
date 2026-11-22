import { ORPCError } from "@orpc/server";
import type { PrismaClient } from "@rakazo/db";
import { isTeamSpace, runAsSystem } from "@rakazo/db";

/**
 * Manor: upstream's sharing of a Space by invite link (invites, joining by link, its members
 * list, removing, leaving and handing over) stays off. A person invited from another
 * organization cannot act in the Space under the portal rule (`assertPortalAccess`), and Manor's
 * team spaces already share a Space through one shared account (`space.accountUserId`); a Space
 * with both would mix the two models. Lifting it is this one line, once both are reconciled.
 */
export const SPACE_SHARING_AVAILABLE: boolean = false;

export const SPACE_SHARING_UNAVAILABLE = "SPACE_SHARING_UNAVAILABLE";

/** Refuses every invite-link sharing procedure while sharing is off. */
export function assertSpaceSharingAvailable(available = SPACE_SHARING_AVAILABLE): void {
  if (available) return;
  throw new ORPCError("FORBIDDEN", {
    message: "Sharing a Space by invite link is not available on this deployment.",
    data: { reason: SPACE_SHARING_UNAVAILABLE },
  });
}

/**
 * A Space with a shared account is a Manor team space: its people come from the organization,
 * never from an invite link, and nobody leaves or is removed through upstream's hand-over.
 * (`isTeamSpace` is the database's one definition; this answers with the sharing reason.)
 */
export async function assertNotTeamSpace(prisma: PrismaClient, spaceId: string): Promise<void> {
  const team = await runAsSystem("check whether a Space is a team space", () =>
    isTeamSpace(prisma, spaceId),
  );
  if (!team) return;
  throw new ORPCError("FORBIDDEN", {
    message: "Members of a team space are managed by its organization.",
    data: { reason: SPACE_SHARING_UNAVAILABLE },
  });
}
