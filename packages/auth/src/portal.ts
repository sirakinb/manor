import { defaultBrand, resolveBrand } from "@rakazo/brands";
import { type PrismaClient, requireMembership } from "@rakazo/db";
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

export async function assertPortalAccess(prisma: PrismaClient, userId: string, headers: Headers) {
  const brandId = portalBrandId(headers);
  const user = await prisma.user.findUniqueOrThrow({
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
  userId: string,
  request: Request,
) {
  const portalOrganizationId = await assertPortalAccess(prisma, userId, request.headers);
  const actor = await requireMembership(
    prisma,
    userId,
    request.headers.get("x-rakazo-space-id"),
    portalOrganizationId,
  );
  return { ...actor, portalOrganizationId };
}
