import type { Prisma } from "@rakazo/db";

/**
 * Manor: a page is shared for review ("Specific people") only with people in the organization of
 * the page's Space. One deployment holds several organizations, and a reviewer's comments and
 * revision requests become input to the page owner's bot, so review stays inside the
 * organization like cross-space communication does. Lifting it is this one line.
 */
export const PAGE_REVIEW_OUTSIDE_ORGANIZATION_AVAILABLE: boolean = false;

/**
 * The accounts a grant may bind to. An account outside the organization is looked up the same
 * way and simply not found, so the answer matches upstream's for an address with no account.
 */
export function pageReviewerScope(
  organizationId: string,
  available = PAGE_REVIEW_OUTSIDE_ORGANIZATION_AVAILABLE,
): Prisma.UserWhereInput {
  return available ? {} : { members: { some: { organizationId } } };
}
