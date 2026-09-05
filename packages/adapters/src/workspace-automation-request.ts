import type { JobPublisher } from "@rakazo/adapter-kit";
import { workspaceAutomationRunNowJob } from "@rakazo/adapter-kit";
import {
  ensureDefaultAutomations,
  IsolationError,
  type PrismaClient,
  requireWorkspaceAutomation,
} from "@rakazo/db";

export class WorkspaceAutomationRequestError extends Error {}

/** Shared by human and bot run-now requests; role checks cannot be bypassed by tools. */
export async function requestWorkspaceAutomationRun(
  prisma: PrismaClient,
  jobs: JobPublisher | undefined,
  actor: { organizationId: string; userId: string },
  key: string,
  now = new Date(),
) {
  const workspace = await prisma.workspace.findUnique({
    where: { organizationId: actor.organizationId },
  });
  if (!workspace) throw new IsolationError();
  const member = await prisma.member.findFirst({
    where: { organizationId: actor.organizationId, userId: actor.userId },
    select: { role: true },
  });
  if (!(member?.role ?? "").split(",").some((role) => ["owner", "admin"].includes(role.trim()))) {
    throw new WorkspaceAutomationRequestError(
      "Only organization owners and admins can run automations.",
    );
  }
  if (!jobs) throw new WorkspaceAutomationRequestError("Background jobs are not available.");
  await ensureDefaultAutomations(prisma, workspace, now);
  const automation = await requireWorkspaceAutomation(prisma, workspace.id, key);
  const run = await prisma.workspaceSyncRun.create({
    data: {
      workspaceId: workspace.id,
      automationId: automation.id,
      status: "queued",
      startedAt: now,
      metadata: { requestedByUserId: actor.userId },
    },
  });
  try {
    await jobs.enqueue(workspaceAutomationRunNowJob(automation.id, run.id));
  } catch {
    await prisma.workspaceSyncRun.updateMany({
      where: { id: run.id, status: "queued" },
      data: {
        status: "error",
        finishedAt: now,
        errorMessage: "Could not queue automation.",
      },
    });
    throw new WorkspaceAutomationRequestError("Could not queue automation. Try again.");
  }
  return { runId: run.id };
}
