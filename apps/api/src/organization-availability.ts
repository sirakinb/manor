import { ORPCError } from "@orpc/server";
import type { Actor, OrganizationList } from "@rakazo/contracts";
import { assertActorOrganization } from "@rakazo/db";

/**
 * Manor: a session acts only in its portal's organization (`assertPortalAccess` in
 * `@rakazo/auth`), so upstream's creating a further organization and moving a session into
 * another one stay off on every portal, for every account including the deployment owner.
 * Lifting it is this one line, once the portal rule is reconciled with switching.
 */
export const ORGANIZATION_CHANGES_AVAILABLE: boolean = false;

export const ORGANIZATIONS_UNAVAILABLE = "ORGANIZATIONS_UNAVAILABLE";

/** Refuses creating an organization, or anything that moves the session into another one. */
export function assertOrganizationChangesAvailable(
  available = ORGANIZATION_CHANGES_AVAILABLE,
): void {
  if (available) return;
  throw new ORPCError("FORBIDDEN", {
    message: "Adding or switching organizations is not available on this deployment.",
    data: { reason: ORGANIZATIONS_UNAVAILABLE },
  });
}

/** Only the organization this session may act in; the rest are reached through their own portal. */
export function permittedOrganizations(
  list: OrganizationList,
  actor: Pick<Actor, "organizationId" | "portalOrganizationId">,
  available = ORGANIZATION_CHANGES_AVAILABLE,
): OrganizationList {
  if (available) return list;
  return {
    ...list,
    organizations: list.organizations.filter((organization) => {
      try {
        assertActorOrganization(actor, organization.id);
        return true;
      } catch {
        return false;
      }
    }),
  };
}
