import { type Actor, TEAM_ACTIVE_MS, TEAM_HEARTBEAT_MS } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

export function createTeamRepos(prisma: PrismaClient) {
  async function requireMember(actor: Actor) {
    const member = await prisma.member.findUnique({
      where: {
        organizationId_userId: { organizationId: actor.organizationId, userId: actor.userId },
      },
      select: { id: true },
    });
    if (!member) throw new IsolationError();
  }
  return {
    async list(actor: Actor, now = new Date()) {
      await requireMember(actor);
      const members = await prisma.member.findMany({
        where: {
          organizationId: actor.organizationId,
          user: { isSpaceAccount: false },
          organization: { members: { some: { userId: actor.userId } } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          userId: true,
          role: true,
          lastActiveAt: true,
          user: {
            select: {
              name: true,
              lastSignedInAt: true,
              sessions: {
                where: { expiresAt: { gt: now } },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      });
      return members.map(({ userId, user, role, lastActiveAt }) => ({
        id: userId,
        name: user.name,
        role,
        lastSignedInAt: user.lastSignedInAt?.toISOString() ?? null,
        lastActiveAt: lastActiveAt?.toISOString() ?? null,
        active:
          user.sessions.length > 0 &&
          lastActiveAt !== null &&
          now.getTime() - lastActiveAt.getTime() >= 0 &&
          now.getTime() - lastActiveAt.getTime() < TEAM_ACTIVE_MS,
      }));
    },
    async heartbeat(actor: Actor, now = new Date()) {
      await requireMember(actor);
      await prisma.member.updateMany({
        where: {
          organizationId: actor.organizationId,
          userId: actor.userId,
          OR: [
            { lastActiveAt: null },
            { lastActiveAt: { lte: new Date(now.getTime() - TEAM_HEARTBEAT_MS) } },
          ],
        },
        data: { lastActiveAt: now },
      });
      return { ok: true as const };
    },
  };
}
