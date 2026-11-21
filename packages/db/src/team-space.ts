import type { Prisma, PrismaClient } from "./client.js";

/**
 * Manor's team spaces. A team space has one shared space account (`spaces.accountUserId`, a user
 * with `isSpaceAccount`); the organization's people are members beside it and act as that account,
 * so models, connected accounts, approval rules, routines and runs belong to it. Upstream's shared
 * space (invite links, per-person accounts, leave, removal and hand-over) is a different model and
 * never applies to a team space.
 */

/** Space members who are people: the shared space account is never listed or counted as one. */
export const PERSON_MEMBER: Prisma.SpaceMemberWhereInput = {
  member: { user: { isSpaceAccount: false } },
};

/** True when the space has a shared space account. */
export async function isTeamSpace(
  db: Pick<PrismaClient, "space">,
  spaceId: string,
): Promise<boolean> {
  const space = await db.space.findUnique({
    where: { id: spaceId },
    select: { accountUserId: true },
  });
  return Boolean(space?.accountUserId);
}

/** Upstream's invite, leave, removal and hand-over refuse a team space. */
export class TeamSpaceSharingError extends Error {
  readonly code = "FORBIDDEN";
  constructor() {
    super("Members of a team space are managed by its organization");
    this.name = "TeamSpaceSharingError";
  }
}

/** Refuses upstream's per-person membership changes on a team space, so the two never mix. */
export async function assertNotTeamSpace(
  db: Pick<PrismaClient, "space">,
  spaceId: string,
): Promise<void> {
  if (await isTeamSpace(db, spaceId)) throw new TeamSpaceSharingError();
}

/**
 * Whether `userId` acts for a run that belongs to `runUserId` in this space: the same user, or a
 * person in the team space whose shared account the run uses.
 */
export async function actsForRunUser(
  db: Pick<PrismaClient, "spaceMember">,
  input: { spaceId: string; runUserId: string; userId: string },
): Promise<boolean> {
  if (input.userId === input.runUserId) return true;
  const member = await db.spaceMember.findFirst({
    where: {
      spaceId: input.spaceId,
      userId: input.userId,
      space: { accountUserId: input.runUserId },
      ...PERSON_MEMBER,
    },
    select: { id: true },
  });
  return member !== null;
}
