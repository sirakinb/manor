import { randomUUID } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import { Prisma, type PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";
import { withTransactionRetry } from "./transaction-retry.js";

/** Resolve only after authenticating the person. Account identity is never client supplied. */
export async function spaceResourceActor(prisma: PrismaClient, actor: Actor): Promise<Actor> {
  if (!actor.spaceAccountUserId) return actor;
  const userId = actor.initiatedByUserId ?? actor.userId;
  const member = await prisma.spaceMember.findFirst({
    where: {
      userId,
      spaceId: actor.spaceId,
      organizationId: actor.organizationId,
      member: { user: { isSpaceAccount: false } },
    },
    select: { space: { select: { accountUser: { select: { id: true, email: true } } } } },
  });
  if (!member) throw new IsolationError();
  const account = member.space.accountUser;
  if (account?.id !== actor.spaceAccountUserId) throw new IsolationError();
  return account
    ? {
        ...actor,
        userId: account.id,
        email: account.email,
        initiatedByUserId: userId,
        isDeploymentOwner: false,
      }
    : actor;
}

/** The account has no password, OAuth identity or session and cannot authenticate. */
export async function createSpaceAccount(
  tx: Prisma.TransactionClient,
  space: { id: string; organizationId: string; name: string },
) {
  const id = randomUUID();
  const createdAt = new Date();
  await tx.user.create({
    data: { id, name: space.name, email: `${id}@space.invalid`, isSpaceAccount: true },
  });
  await tx.member.create({
    data: {
      id: randomUUID(),
      userId: id,
      organizationId: space.organizationId,
      role: "service",
      createdAt,
    },
  });
  await tx.spaceMember.upsert({
    where: { spaceId_userId: { spaceId: space.id, userId: id } },
    create: {
      id: randomUUID(),
      userId: id,
      spaceId: space.id,
      organizationId: space.organizationId,
      role: "service",
      createdAt,
    },
    update: { role: "service" },
  });
  await tx.space.update({ where: { id: space.id }, data: { accountUserId: id } });
  return id;
}

export async function sharedMessageAuthor(prisma: PrismaClient, actor: Actor) {
  if (!actor.initiatedByUserId) return {};
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.initiatedByUserId },
    select: { name: true },
  });
  return { authorUserId: actor.initiatedByUserId, authorName: user.name };
}

export async function spaceNotificationRecipients(
  prisma: PrismaClient,
  scope: { spaceId: string; userId: string },
): Promise<string[]> {
  const space = await prisma.space.findUniqueOrThrow({
    where: { id: scope.spaceId },
    select: { accountUserId: true },
  });
  if (!space.accountUserId) return [scope.userId];
  if (space.accountUserId !== scope.userId) return [];
  const members = await prisma.spaceMember.findMany({
    where: { spaceId: scope.spaceId, member: { user: { isSpaceAccount: false } } },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

/** Operator migration for an unstarted space. Existing live accounts require a provider migration. */
export async function shareUnstartedSpace(prisma: PrismaClient, spaceId: string) {
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM spaces WHERE id = ${spaceId} FOR UPDATE`;
        const space = await tx.space.findUniqueOrThrow({ where: { id: spaceId } });
        if (space.accountUserId) return space.accountUserId;
        const occupied = await Promise.all([
          tx.actionApprovalRule.count({ where: { spaceId } }),
          tx.actionAutoReviewPreference.count({ where: { spaceId } }),
          tx.integrationCredential.count({ where: { spaceId } }),
          tx.workspaceKnowledgeImport.count({ where: { spaceId } }),
          tx.run.count({ where: { spaceId } }),
          tx.task.count({ where: { spaceId } }),
          tx.connection.count({ where: { spaceId } }),
          tx.secret.count({ where: { spaceId } }),
          tx.mcpServer.count({ where: { spaceId } }),
          tx.mcpOAuthSession.count({ where: { spaceId } }),
          tx.spaceMemoryConfig.count({ where: { spaceId } }),
          tx.capabilityInstall.count({ where: { spaceId } }),
          tx.messagingIdentity.count({ where: { spaceId } }),
          tx.messagingLinkCode.count({ where: { spaceId } }),
          tx.agentHome.count({ where: { spaceId } }),
          tx.computer.count({
            where: { spaceId, OR: [{ providerRef: { not: null } }, { state: "running" }] },
          }),
          tx.artifact.count({ where: { spaceId } }),
          tx.botSection.count({ where: { spaceId } }),
          tx.chatGroup.count({ where: { spaceId } }),
          tx.routine.count({ where: { spaceId } }),
          tx.taughtSkill.count({ where: { spaceId } }),
          tx.agentSkill.count({ where: { spaceId } }),
          tx.botCredential.count({ where: { spaceId } }),
          tx.botMcpServer.count({ where: { spaceId } }),
          tx.scratchpadItem.count({ where: { spaceId } }),
          tx.usageRecord.count({ where: { spaceId } }),
          tx.browserProfile.count({ where: { spaceId, secretId: { not: null } } }),
        ]);
        if (occupied.some(Boolean))
          throw new Error("This space has active account data and needs a reviewed migration.");
        // Multiple private owners can have the same nullable-bot memory path.
        // Coalesce only identical seed documents; preserve any edited history for review.
        const memory = await tx.memoryDocument.findMany({
          where: { spaceId },
          orderBy: { id: "asc" },
          include: { _count: { select: { revisions: true } } },
        });
        const byPath = new Map<string, (typeof memory)[number]>();
        const duplicateIds: string[] = [];
        for (const document of memory) {
          const key = JSON.stringify([document.scope, document.botId, document.path]);
          const previous = byPath.get(key);
          if (!previous) {
            byPath.set(key, document);
            continue;
          }
          if (
            previous.content !== document.content ||
            previous.revision !== 1 ||
            document.revision !== 1 ||
            previous._count.revisions ||
            document._count.revisions
          )
            throw new Error("This space has conflicting memory and needs a reviewed migration.");
          duplicateIds.push(document.id);
        }
        if (duplicateIds.length)
          await tx.memoryDocument.deleteMany({ where: { id: { in: duplicateIds } } });
        const accountUserId = await createSpaceAccount(tx, space);
        const members = await tx.member.findMany({
          where: { organizationId: space.organizationId, user: { isSpaceAccount: false } },
          select: { userId: true },
        });
        await tx.spaceMember.createMany({
          data: members.map(({ userId }) => ({
            id: randomUUID(),
            spaceId,
            organizationId: space.organizationId,
            userId,
            role: "member",
            createdAt: new Date(),
          })),
          skipDuplicates: true,
        });
        const threads = await tx.thread.findMany({
          where: { spaceId },
          select: { id: true, userId: true },
        });
        for (const thread of threads) {
          const user = await tx.user.findUnique({
            where: { id: thread.userId },
            select: { name: true },
          });
          await tx.message.updateMany({
            where: { threadId: thread.id, role: "user", authorUserId: null },
            data: { authorUserId: thread.userId, authorName: user?.name ?? "Team member" },
          });
        }
        await tx.bot.updateMany({ where: { spaceId }, data: { userId: accountUserId } });
        await tx.thread.updateMany({ where: { spaceId }, data: { userId: accountUserId } });
        await tx.browserProfile.updateMany({ where: { spaceId }, data: { userId: accountUserId } });
        await tx.computer.updateMany({ where: { spaceId }, data: { userId: accountUserId } });
        await tx.memoryDocument.updateMany({ where: { spaceId }, data: { userId: accountUserId } });
        await tx.notificationPreference.create({ data: { spaceId, userId: accountUserId } });
        return accountUserId;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
