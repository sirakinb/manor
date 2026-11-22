import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@rakazo/db";

/**
 * Puts `userId` in the owner's space the way upstream's sharing does: an accepted invite from
 * the owner, then the person's membership. Manor: a space without a shared account holds one
 * person unless it is shared by invite, and joining an organization no longer adds anyone to
 * its default space, so tests about two people in one space use this shape. Call it with the
 * system client; the person must already be a member of the space's organization.
 */
export async function shareSpaceByInvite(
  db: PrismaClient,
  input: { spaceId: string; ownerUserId: string; userId: string },
): Promise<void> {
  const space = await db.space.findUniqueOrThrow({
    where: { id: input.spaceId },
    select: { organizationId: true, accountUserId: true },
  });
  if (space.accountUserId) throw new Error("A team space is joined through its organization");
  const now = new Date();
  await db.spaceInvite.create({
    data: {
      spaceId: input.spaceId,
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      createdByUserId: input.ownerUserId,
      expiresAt: new Date(now.getTime() + 86_400_000),
      acceptedAt: now,
      acceptedByUserId: input.userId,
    },
  });
  await db.spaceMember.upsert({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
    update: {},
    create: {
      id: randomUUID(),
      spaceId: input.spaceId,
      organizationId: space.organizationId,
      userId: input.userId,
      role: "member",
      createdAt: now,
    },
  });
}
