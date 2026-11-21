import type { Prisma, PrismaClient } from "./client.js";

/**
 * Whether one bot may talk to another. Bots in one Space always may; bots in different Spaces
 * only when both have opted in and both Spaces belong to the same organization (Manor: one
 * database hosts several organizations and brand portals). Call within the delivery
 * transaction to serialize against disabling either bot, in a system context: a tenant
 * context cannot see the other Space's bot, so the pair would be refused.
 */
export async function crossSpaceCommunicationAllowed(
  prisma: Pick<PrismaClient | Prisma.TransactionClient, "$queryRaw">,
  senderBotId: string,
  targetBotId: string,
): Promise<boolean> {
  const bots = await prisma.$queryRaw<
    Array<{
      id: string;
      spaceId: string;
      organizationId: string | null;
      crossSpaceCommunication: boolean;
      archivedAt: Date | null;
    }>
  >`
    SELECT b.id, b."spaceId", s."organizationId", b."crossSpaceCommunication", b."archivedAt"
    FROM bots b LEFT JOIN spaces s ON s.id = b."spaceId"
    WHERE b.id = ${senderBotId} OR b.id = ${targetBotId}
    ORDER BY b.id FOR NO KEY UPDATE OF b
  `;
  if (bots.length !== 2 || bots.some((bot) => bot.archivedAt)) return false;
  const [first, second] = bots as [(typeof bots)[0], (typeof bots)[0]];
  if (first.spaceId === second.spaceId) return true;
  return (
    !!first.organizationId &&
    first.organizationId === second.organizationId &&
    bots.every((bot) => bot.crossSpaceCommunication === true)
  );
}

export class CrossSpaceCommunicationBlockedError extends Error {
  constructor() {
    super("Cross-space bot communication is disabled.");
    this.name = "CrossSpaceCommunicationBlockedError";
  }
}
