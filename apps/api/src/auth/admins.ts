import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type { RouterDeps } from "../router.js";

type AdminDeps = Pick<RouterDeps, "prisma"> & { env: Pick<RouterDeps["env"], "adminEmails"> };
type Person = Pick<Actor, "userId" | "initiatedByUserId" | "isDeploymentOwner">;

/**
 * Accounts listed in RAKAZO_ADMIN_EMAILS once their email is verified, and Manor's deployment
 * owner. Always the signed-in person: in a shared team space the actor is the space account,
 * whose own isDeploymentOwner is false, so the owner is looked up for the initiator.
 */
export async function isAdmin(deps: AdminDeps, actor: Person): Promise<boolean> {
  if (!actor.initiatedByUserId && actor.isDeploymentOwner) return true;
  const personId = actor.initiatedByUserId ?? actor.userId;
  if (actor.initiatedByUserId) {
    const settings = await deps.prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: { ownerUserId: true },
    });
    if (settings?.ownerUserId === personId) return true;
  }
  const admins = deps.env.adminEmails ?? [];
  if (admins.length === 0) return false;
  const user = await deps.prisma.user.findUnique({
    where: { id: personId },
    select: { email: true, emailVerified: true },
  });
  return Boolean(user?.emailVerified && admins.includes(user.email.toLowerCase()));
}

export async function requireAdmin(deps: AdminDeps, actor: Person): Promise<void> {
  if (!(await isAdmin(deps, actor))) throw new ORPCError("FORBIDDEN", { message: "Admins only" });
}
