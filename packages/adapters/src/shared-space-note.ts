import type { PrismaClient } from "@rakazo/db";
import { PERSON_MEMBER } from "@rakazo/db";
import { personSpeakerName } from "./history-speakers.js";
import { formatSharedSpaceNote as formatPeopleSharedSpaceNote } from "./run-instructions.prompt.js";

/**
 * Upstream's note on a space several people share, plus Manor's team space: a team space acts
 * as one shared account, so every member's turn uses its connected accounts and no person's.
 */
export function formatSharedSpaceNote(
  memberNames: string[],
  requesterName?: string,
  teamSpace = false,
): string {
  if (!teamSpace) return formatPeopleSharedSpaceNote(memberNames, requesterName);
  return [
    formatPeopleSharedSpaceNote(memberNames),
    "This turn uses the team space's shared connected accounts, the same ones every member's turns use.",
  ].join(" ");
}

export async function loadSharedSpaceNote(
  prisma: Pick<PrismaClient, "spaceMember">,
  spaceId: string,
  requesterUserId: string,
  options: { teamSpace?: boolean } = {},
): Promise<string | undefined> {
  const members = await prisma.spaceMember.findMany({
    // Manor: a team space's shared account is not a person, so it is never listed as one.
    where: { spaceId, ...PERSON_MEMBER },
    select: { userId: true, member: { select: { user: { select: { name: true } } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (members.length < 2) return undefined;
  const requester = members.find((member) => member.userId === requesterUserId);
  // The same names the history labels use, so the model can match them.
  return formatSharedSpaceNote(
    members.map((member) => personSpeakerName(member.member.user.name)),
    requester && personSpeakerName(requester.member.user.name),
    options.teamSpace,
  );
}
