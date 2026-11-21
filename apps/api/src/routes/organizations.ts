import { ORPCError } from "@orpc/server";
import {
  assertActorOrganization,
  CannotDeleteLastOrganizationError,
  createOrganizationForUser,
  firstOrganizationSpace,
  InvalidSpaceNameError,
  listMemberOrganizations,
  OrganizationLimitError,
  recordAuditEvent,
  renameOrganization,
  runAsSystem,
  SharedOrganizationError,
  SpaceDeletionInProgressError,
} from "@rakazo/db";
import { deleteOrganization } from "../account-deletion.js";
import { OrganizationHoldsBusinessDataError } from "../account-deletion-guard.js";
import {
  assertOrganizationChangesAvailable,
  ORGANIZATION_CHANGES_AVAILABLE,
  permittedOrganizations,
} from "../organization-availability.js";
import type { RouterContext } from "./context.js";

export function organizationsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const available = deps.organizationChangesAvailable ?? ORGANIZATION_CHANGES_AVAILABLE;
  return {
    organizations: {
      // Manor: these act on the signed-in person's own memberships, so they stay on `authed`;
      // each is limited to the one organization the session's portal permits.
      list: authed.organizations.list.handler(({ context }) =>
        runAsSystem("list the organizations a user belongs to", async () =>
          permittedOrganizations(
            await listMemberOrganizations(deps.prisma, context.actor),
            context.actor,
            available,
          ),
        ),
      ),
      create: authed.organizations.create.handler(({ context, input }) =>
        runAsSystem("create an organization for its owner", async () => {
          assertOrganizationChangesAvailable(available);
          let organization: Awaited<ReturnType<typeof createOrganizationForUser>>;
          try {
            organization = await createOrganizationForUser(deps.prisma, {
              userId: context.actor.userId,
              name: input.name,
            });
          } catch (error) {
            if (error instanceof OrganizationLimitError)
              throw new ORPCError("BAD_REQUEST", { message: error.message });
            if (error instanceof InvalidSpaceNameError) throw invalidOrganizationName();
            throw error;
          }
          await recordAuditEvent({
            action: "organization.created",
            actor: { type: "user", id: context.actor.userId },
            organizationId: organization.id,
            target: { type: "organization", id: organization.id, label: organization.name },
          });
          return organization;
        }),
      ),
      rename: authed.organizations.rename.handler(({ context, input }) =>
        runAsSystem("rename an organization for its owner", async () => {
          if (!available) assertActorOrganization(context.actor, input.organizationId);
          let renamed: { id: string; name: string };
          try {
            renamed = await renameOrganization(deps.prisma, {
              userId: context.actor.userId,
              organizationId: input.organizationId,
              name: input.name,
            });
          } catch (error) {
            if (error instanceof InvalidSpaceNameError) throw invalidOrganizationName();
            throw error;
          }
          await recordAuditEvent({
            action: "organization.renamed",
            actor: { type: "user", id: context.actor.userId },
            organizationId: renamed.id,
            target: { type: "organization", id: renamed.id, label: renamed.name },
          });
          return renamed;
        }),
      ),
      remove: authed.organizations.remove.handler(({ context, input }) =>
        runAsSystem("delete an organization with its content", async () => {
          // Manor: deleting one organization moves the session into another (`activeSpaceId`).
          assertOrganizationChangesAvailable(available);
          const { userId } = context.actor;
          try {
            await deleteOrganization(deps, userId, input.organizationId);
          } catch (error) {
            if (
              error instanceof CannotDeleteLastOrganizationError ||
              error instanceof SharedOrganizationError ||
              error instanceof OrganizationHoldsBusinessDataError
            )
              throw new ORPCError("BAD_REQUEST", { message: error.message });
            if (error instanceof SpaceDeletionInProgressError)
              throw new ORPCError("CONFLICT", { message: error.message });
            throw error;
          }
          return {
            ok: true as const,
            activeSpaceId: await firstOrganizationSpace(deps.prisma, userId),
          };
        }),
      ),
    },
  };
}

function invalidOrganizationName() {
  return new ORPCError("BAD_REQUEST", {
    message: "Organization name must be readable and between 1 and 60 characters",
  });
}
