import { randomUUID } from "node:crypto";
import type { MaintenanceAdapter } from "@rakazo/adapter-kit";
import {
  type MaintenanceApproval,
  type MaintenanceCreate,
  MaintenanceJobSchema,
  MaintenanceReviewSchema,
} from "@rakazo/contracts";
import { maintenanceReviewPassed } from "@rakazo/core";
import { approvalEffectKey } from "@rakazo/core/node/approval-effect-key";
import type { Prisma, PrismaClient } from "@rakazo/db";

export class MaintenanceError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

type Row = Prisma.MaintenanceJobGetPayload<Record<string, never>>;
const activeStatuses = ["queued", "investigating", "approved", "releasing"];

function dto(row: Row) {
  return MaintenanceJobSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Checks the authoritative deployment identity afresh, including from workers.
 * Neither organization roles nor a stale actor flag are sufficient.
 */
export async function requireMaintenanceOwner(
  prisma: Pick<PrismaClient, "deploymentSettings">,
  userId: string,
) {
  const settings = await prisma.deploymentSettings.findUnique({
    where: { id: "default" },
    select: { ownerUserId: true },
  });
  if (!userId || settings?.ownerUserId !== userId)
    throw new MaintenanceError("FORBIDDEN", "Maintenance is restricted to the deployment owner.");
}

export function createMaintenanceService(prisma: PrismaClient, adapter?: MaintenanceAdapter) {
  const owned = async (userId: string, id: string) => {
    await requireMaintenanceOwner(prisma, userId);
    const row = await prisma.maintenanceJob.findFirst({ where: { id, ownerUserId: userId } });
    if (!row) throw new MaintenanceError("NOT_FOUND", "Maintenance job not found.");
    return row;
  };
  const change = async (row: Row, data: Prisma.MaintenanceJobUpdateManyMutationInput) => {
    const result = await prisma.maintenanceJob.updateMany({
      where: { id: row.id, version: row.version, status: row.status },
      data: { ...data, version: { increment: 1 } },
    });
    if (!result.count)
      throw new MaintenanceError("CONFLICT", "This job changed. Refresh before continuing.");
  };
  return {
    async list(userId: string) {
      await requireMaintenanceOwner(prisma, userId);
      const rows = await prisma.maintenanceJob.findMany({
        where: { ownerUserId: userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return { mode: adapter?.mode ?? ("unavailable" as const), jobs: rows.map(dto) };
    },
    async create(userId: string, input: MaintenanceCreate, evidence: Prisma.InputJsonValue) {
      await requireMaintenanceOwner(prisma, userId);
      const row = await prisma.maintenanceJob.upsert({
        where: { ownerUserId_requestId: { ownerUserId: userId, requestId: input.requestId } },
        create: {
          id: randomUUID(),
          ownerUserId: userId,
          requestId: input.requestId,
          issue: input.issue,
          runId: input.runId,
          evidence,
          simulated: adapter?.mode === "test",
          status: adapter ? "queued" : "blocked",
          message: adapter
            ? "Queued for investigation."
            : "Workspace and release integration is not connected. Issue saved; no agent has started.",
        },
        update: {},
      });
      if (row.issue !== input.issue || row.runId !== (input.runId ?? null))
        throw new MaintenanceError(
          "CONFLICT",
          "This request ID already belongs to a different issue.",
        );
      return dto(row);
    },
    async approve(userId: string, input: MaintenanceApproval) {
      const row = await owned(userId, input.id);
      if (
        row.reviewKey === input.reviewKey &&
        row.approvedRevision === input.revision &&
        ["approved", "releasing", "completed"].includes(row.status)
      )
        return dto(row);
      const review = MaintenanceReviewSchema.safeParse(row.review);
      if (
        !adapter ||
        row.simulated !== (adapter.mode === "test") ||
        row.status !== "review" ||
        !review.success ||
        !maintenanceReviewPassed(review.data) ||
        (adapter.mode === "connected" && !review.data.release) ||
        row.reviewKey !== input.reviewKey ||
        row.reviewKey !== approvalEffectKey(row.id, "maintenance.release", review.data) ||
        review.data.revision !== input.revision
      )
        throw new MaintenanceError(
          "CONFLICT",
          "Approve only the current revision with passing checks and a safe review bundle.",
        );
      await change(row, {
        status: "approved",
        approvedRevision: input.revision,
        message: "Exact tested revision approved; waiting for release service.",
        nextAttemptAt: new Date(),
      });
      return dto(await owned(userId, input.id));
    },
    async cancel(userId: string, id: string) {
      const row = await owned(userId, id);
      if (row.status === "cancelled") return dto(row);
      if (!["queued", "investigating", "review", "blocked", "failed"].includes(row.status))
        throw new MaintenanceError(
          "CONFLICT",
          "A release already approved cannot be cancelled here.",
        );
      // Investigation has no publishing/deployment authority. An in-flight result is
      // discarded by the version fence; isolated workspace expiry belongs to its service.
      await change(row, {
        status: "cancelled",
        message: "Cancelled. No release will be requested.",
      });
      return dto(await owned(userId, id));
    },
    async advance(id: string) {
      const row = await prisma.maintenanceJob.findUnique({ where: { id } });
      if (!row || !activeStatuses.includes(row.status)) return;
      try {
        await requireMaintenanceOwner(prisma, row.ownerUserId);
      } catch (error) {
        if (!(error instanceof MaintenanceError)) throw error;
        await change(row, {
          status: "blocked",
          message: "Deployment ownership changed. This job is blocked.",
        });
        return;
      }
      if (!adapter || row.simulated !== (adapter.mode === "test")) {
        await change(row, {
          status: "blocked",
          message: "The matching workspace and release integration is unavailable.",
        });
        return;
      }
      const nextAttemptAt = new Date(Date.now() + 30_000);
      if (row.status === "queued" || row.status === "approved") {
        await change(row, {
          status: row.status === "queued" ? "investigating" : "releasing",
          nextAttemptAt: new Date(),
          message:
            row.status === "queued"
              ? "Investigating in an isolated workspace."
              : "Release service is processing the approved revision.",
        });
        await createMaintenanceService(prisma, adapter).advance(id);
        return;
      }
      try {
        if (row.status === "investigating") {
          const result = await adapter.investigate({
            operationId: `${row.id}:investigate`,
            ownerUserId: row.ownerUserId,
            issue: row.issue,
            evidence: row.evidence,
            signal: AbortSignal.timeout(adapter.mode === "connected" ? 20 * 60_000 : 20_000),
          });
          await requireMaintenanceOwner(prisma, row.ownerUserId);
          if (result.status === "running") {
            await change(row, { nextAttemptAt });
            return;
          }
          if (result.status === "failed") {
            await change(row, { status: "failed", message: result.message });
            return;
          }
          const review = MaintenanceReviewSchema.parse(result.review);
          const reviewKey = approvalEffectKey(row.id, "maintenance.release", review);
          await change(row, {
            status: "review",
            review,
            reviewKey,
            message: maintenanceReviewPassed(review)
              ? "Changes are ready for your review."
              : "Checks or publication review failed. Deployment is disabled.",
          });
        } else {
          const review = MaintenanceReviewSchema.parse(row.review);
          if (
            !maintenanceReviewPassed(review) ||
            (adapter.mode === "connected" && !review.release) ||
            row.approvedRevision !== review.revision ||
            row.reviewKey !== approvalEffectKey(row.id, "maintenance.release", review)
          ) {
            await change(row, {
              status: "blocked",
              message: "The approved review bundle no longer matches.",
            });
            return;
          }
          const result = await adapter.release({
            operationId: `${row.id}:release:${review.revision}`,
            ownerUserId: row.ownerUserId,
            revision: review.revision,
            reviewKey: row.reviewKey,
            review,
            signal: AbortSignal.timeout(20_000),
          });
          await requireMaintenanceOwner(prisma, row.ownerUserId);
          await change(row, {
            status: result.status === "running" ? "releasing" : result.status,
            nextAttemptAt,
            message:
              result.status === "completed"
                ? row.simulated
                  ? "Simulation completed. No deployment changed."
                  : "Release service confirmed the update."
                : result.status === "failed"
                  ? "Release service reported a failed update. Check release diagnostics."
                  : "Waiting for release confirmation.",
          });
        }
      } catch (error) {
        if (error instanceof MaintenanceError && error.code === "CONFLICT") return;
        // Never expose provider errors: they can contain tokens, repository or customer data.
        await change(row, {
          nextAttemptAt,
          message: "Service response unavailable or invalid. Retrying the same operation safely.",
        });
      }
    },
  };
}
