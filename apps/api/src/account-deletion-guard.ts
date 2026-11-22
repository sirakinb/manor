import { ClientError } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";

export const ACCOUNT_DELETION_REFUSED = "ACCOUNT_DELETION_REFUSED";

/** Deleting this account would remove or orphan data other people rely on. */
export class AccountDeletionRefusedError extends Error {
  readonly code = ACCOUNT_DELETION_REFUSED;
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionRefusedError";
  }
}

/** Deleting this organization would remove its Workspace, CRM data or public forms. */
export class OrganizationHoldsBusinessDataError extends ClientError {
  constructor() {
    super(
      "BAD_REQUEST",
      "This organization has a Workspace, CRM data or public forms, so it can't be deleted here.",
    );
    this.name = "OrganizationHoldsBusinessDataError";
  }
}

const SHARED_ACCOUNT_MESSAGE = "A shared space's account can't be deleted.";
const ORGANIZATION_MESSAGE =
  "This account belongs to an organization other people or business data depend on. Ask the organization's owner to remove you from it, then delete your account.";

type GuardClient = Pick<
  PrismaClient,
  | "user"
  | "space"
  | "member"
  | "workspace"
  | "crmContact"
  | "crmPipeline"
  | "crmDeal"
  | "crmModule"
  | "publicForm"
>;

/** Whether an organization holds a Workspace, CRM data or public forms. */
async function holdsBusinessData(prisma: GuardClient, organizationId: string): Promise<boolean> {
  const scope = { organizationId };
  const counts = await Promise.all([
    prisma.workspace.count({ where: scope }),
    prisma.crmContact.count({ where: scope }),
    prisma.crmPipeline.count({ where: scope }),
    prisma.crmDeal.count({ where: scope }),
    prisma.crmModule.count({ where: scope }),
    prisma.publicForm.count({ where: scope }),
  ]);
  return counts.some((count) => count > 0);
}

/**
 * Manor: deleting an organization removes the Workspace, CRM and forms inside it, so it is refused
 * while it holds any (upstream already refuses one with other members). Callers run in a context.
 */
export async function assertOrganizationDeletable(
  prisma: GuardClient,
  organizationId: string,
): Promise<void> {
  if (await holdsBusinessData(prisma, organizationId)) {
    throw new OrganizationHoldsBusinessDataError();
  }
}

/**
 * Manor: an account deletion tears down the person's bots and spaces, deletes organizations where
 * they are the only member (with the Workspace, CRM and forms inside), and cascades rows they
 * created for the organization (Workspace credentials, CRM webhooks, integration tokens). So it is
 * refused for a shared space's account, for anyone in an organization with other members, and for
 * a sole member whose organization holds a Workspace, CRM data or public forms.
 */
export async function assertAccountDeletable(prisma: GuardClient, userId: string): Promise<void> {
  await runAsSystem("check whether an account can be deleted", async () => {
    const [user, managedSpaces] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { isSpaceAccount: true } }),
      prisma.space.count({ where: { accountUserId: userId } }),
    ]);
    if (user?.isSpaceAccount || managedSpaces > 0) {
      throw new AccountDeletionRefusedError(SHARED_ACCOUNT_MESSAGE);
    }
    const memberships = await prisma.member.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    for (const { organizationId } of memberships) {
      const [others, businessData] = await Promise.all([
        prisma.member.count({ where: { organizationId, userId: { not: userId } } }),
        holdsBusinessData(prisma, organizationId),
      ]);
      if (others > 0 || businessData) {
        throw new AccountDeletionRefusedError(ORGANIZATION_MESSAGE);
      }
    }
  });
}
