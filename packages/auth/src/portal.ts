import { defaultBrand, resolveBrand } from "@rakazo/brands";
import type { PrismaClient } from "@rakazo/db";
import { ensureOwnSpace, IsolationError, requireMembership, runAsSystem } from "@rakazo/db";
import { APIError } from "better-auth/api";

/** Public proxies preserve Host. Never let Origin override an actual destination host. */
export function portalBrandId(headers: Headers): string | null {
  let hostname = headers.get("host")?.split(":")[0];
  if (!hostname) {
    try {
      hostname = new URL(headers.get("origin") ?? "").hostname;
    } catch {
      /* no browser origin */
    }
  }
  const brand = resolveBrand(hostname ?? "");
  return brand.id === defaultBrand.id ? null : brand.id;
}

/** The account fields the portal rule reads; a session's user carries them (`PORTAL_USER_FIELDS`). */
export type PortalUser = { portalBrandId?: string | null; isSpaceAccount?: boolean | null };

export async function assertPortalAccess(
  prisma: PrismaClient,
  userId: string,
  headers: Headers,
  /** The account as the session just read it; without it the account is read here. */
  known?: PortalUser,
) {
  const brandId = portalBrandId(headers);
  const user =
    typeof known?.isSpaceAccount === "boolean"
      ? { portalBrandId: known.portalBrandId ?? null, isSpaceAccount: known.isSpaceAccount }
      : await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { portalBrandId: true, isSpaceAccount: true },
        });
  if (user.isSpaceAccount)
    throw new APIError("FORBIDDEN", { message: "This account cannot sign in." });
  if (user.portalBrandId && user.portalBrandId !== brandId)
    throw new APIError("FORBIDDEN", { message: "Use your organization's sign-in page." });
  // Manor belongs to the account's first main-portal organization. Membership
  // in a client team must not turn the main portal into an administration view.
  const member = await prisma.member.findFirst({
    where: { userId, organization: { brandId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { organizationId: true },
  });
  if (!member)
    throw new APIError("FORBIDDEN", { message: "This account cannot access this portal." });
  return member.organizationId;
}

export async function requirePortalMembership(
  prisma: PrismaClient,
  user: { id: string; email: string } & PortalUser,
  request: Request,
) {
  const userId = user.id;
  // The session read the account with every request, so the portal rule reuses that read.
  const portalOrganizationId = await assertPortalAccess(prisma, userId, request.headers, user);
  const requestedSpaceId = request.headers.get("x-rakazo-space-id");
  const resolve = () => requireMembership(prisma, user, requestedSpaceId, portalOrganizationId);
  try {
    return { ...(await resolve()), portalOrganizationId };
  } catch (error) {
    if (!(error instanceof IsolationError) || requestedSpaceId) throw error;
    // Manor: a space without a shared account holds one person, and joining an organization adds
    // nobody to another person's space. A session that reaches this portal (one signed in
    // elsewhere, or a member whose shared space was taken away) gets its own space here, as the
    // first sign-in on the portal would have. Only a member (not a guest) of the organization
    // the portal allows, after the pin check above; a request naming a space never creates one.
    const member = await prisma.member.findFirst({
      where: { userId, organizationId: portalOrganizationId, role: { not: "guest" } },
      select: { id: true },
    });
    if (!member) throw error;
    await runAsSystem("own space in the portal's organization", () =>
      ensureOwnSpace(prisma, { id: userId }, portalOrganizationId),
    );
    return { ...(await resolve()), portalOrganizationId };
  }
}
