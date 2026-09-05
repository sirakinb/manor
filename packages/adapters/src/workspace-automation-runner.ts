import type { IngestionRunner, JobPublisher } from "@rakazo/adapter-kit";
import { workspaceAutomationWakeupJob } from "@rakazo/adapter-kit";
import { automationNextRunAt, automationSpec, type PrismaClient } from "@rakazo/db";
import type { EncryptedSecretStore } from "./secrets.js";
import { loadWorkspaceCredential } from "./workspace-credentials.js";

/**
 * One workspace automation run, end to end: claim the wakeup, open a sync
 * run, gather the credentials the pipeline needs, hand the work to the
 * ingestion service, and record the outcome on the run, the automation, and
 * its source. Failures land on the run row; this never throws for a
 * pipeline problem, only for a database one.
 */

const ERROR_TEXT_MAX = 300;
const truncate = (value: string): string => value.slice(0, ERROR_TEXT_MAX);

export interface WorkspaceAutomationDeps {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  jobs: JobPublisher;
  /** Undefined when INGESTION_URL is not configured; runs then fail with a clear message. */
  ingestion?: IngestionRunner;
  now?: () => Date;
}

export async function runWorkspaceAutomation(
  deps: WorkspaceAutomationDeps,
  payload: { automationId: string; runId?: string; scheduledFor?: string },
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const automation = await deps.prisma.workspaceAutomation.findUnique({
    where: { id: payload.automationId },
    include: { workspace: true },
  });
  if (!automation) return;
  const spec = automationSpec(automation.key);
  if (!spec) return;

  // A cron wakeup only fires for the wakeup it was armed for; stale or
  // paused wakeups are dropped. Manual runs go ahead regardless.
  const scheduledAt = payload.scheduledFor ? new Date(payload.scheduledFor) : null;
  if (scheduledAt) {
    if (!Number.isFinite(scheduledAt.getTime())) return;
    if (!automation.enabled || automation.nextRunAt?.getTime() !== scheduledAt.getTime()) return;
    if (scheduledAt.getTime() > now().getTime() + 1_000) {
      await deps.jobs.enqueue(workspaceAutomationWakeupJob(automation.id, scheduledAt));
      return;
    }
  }

  const startedAt = now();
  const nextRunAt = automation.enabled
    ? automationNextRunAt(
        automation.crons,
        automation.timezone,
        new Date(Math.max(startedAt.getTime(), scheduledAt?.getTime() ?? 0)),
      )
    : null;
  if (scheduledAt) {
    const claimed = await deps.prisma.workspaceAutomation.updateMany({
      where: { id: automation.id, nextRunAt: scheduledAt },
      data: { lastRunAt: startedAt, nextRunAt },
    });
    if (claimed.count !== 1) return;
  } else {
    await deps.prisma.workspaceAutomation.update({
      where: { id: automation.id },
      data: { lastRunAt: startedAt },
    });
  }

  // Imports may use lowercase provider names. Reuse the same source identity
  // the read API matches instead of creating a second row for its display name.
  const existingSource = spec.sourceName
    ? await deps.prisma.workspaceSource.findFirst({
        where: {
          workspaceId: automation.workspaceId,
          name: { equals: spec.sourceName, mode: "insensitive" },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { name: true },
      })
    : null;
  const source = spec.sourceName
    ? await deps.prisma.workspaceSource.upsert({
        where: {
          workspaceId_name: {
            workspaceId: automation.workspaceId,
            name: existingSource?.name ?? spec.sourceName,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          name: spec.sourceName,
          sourceType: spec.sourceType,
          status: "connected",
          connectionMethod: "ingestion",
        },
        update: {},
      })
    : null;
  const run = payload.runId
    ? await deps.prisma.workspaceSyncRun.update({
        where: { id: payload.runId },
        data: { status: "running", startedAt, sourceId: source?.id ?? null },
      })
    : await deps.prisma.workspaceSyncRun.create({
        data: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          sourceId: source?.id ?? null,
          status: "running",
          startedAt,
        },
      });

  const finish = async (outcome: {
    status: "success" | "error";
    recordsLoaded: number;
    errorMessage: string | null;
    notes?: string;
  }) => {
    const finishedAt = now();
    await deps.prisma.workspaceSyncRun.update({
      where: { id: run.id },
      data: {
        status: outcome.status,
        finishedAt,
        recordsLoaded: outcome.recordsLoaded,
        errorMessage: outcome.errorMessage,
        metadata: outcome.notes ? { notes: outcome.notes } : {},
      },
    });
    if (source) {
      await deps.prisma.workspaceSource.update({
        where: { id: source.id },
        data:
          outcome.status === "success"
            ? { lastSyncedAt: finishedAt, status: "connected" }
            : { status: "error" },
      });
    }
    if (nextRunAt) {
      await deps.jobs.enqueue(workspaceAutomationWakeupJob(automation.id, nextRunAt));
    }
  };

  if (!deps.ingestion) {
    await finish({
      status: "error",
      recordsLoaded: 0,
      errorMessage: "ingestion service not configured",
    });
    return;
  }

  const credentials: Record<string, Record<string, string>> = {};
  // Recaps prefer an explicitly saved OpenAI credential; OpenRouter remains
  // supported for existing workspaces. Never fall back after a provider fails.
  if (spec.pipeline === "recap") {
    const openai = await loadWorkspaceCredential(
      deps.prisma,
      deps.secrets,
      automation.workspaceId,
      "openai",
    );
    if (openai) credentials.openai = openai;
  }
  for (const provider of spec.credentials) {
    if (spec.pipeline === "recap" && credentials.openai) continue;
    const fields = await loadWorkspaceCredential(
      deps.prisma,
      deps.secrets,
      automation.workspaceId,
      provider,
    );
    if (!fields) {
      await finish({
        status: "error",
        recordsLoaded: 0,
        errorMessage: `missing ${provider} credential`,
      });
      return;
    }
    credentials[provider] = fields;
  }

  const workspace = automation.workspace;
  const sourceConfig =
    source?.config && typeof source.config === "object" && !Array.isArray(source.config)
      ? (source.config as Record<string, unknown>)
      : {};
  const options: Record<string, unknown> = {
    ...sourceConfig,
    scheduledFor: scheduledAt?.toISOString() ?? null,
    manual: !scheduledAt,
    timezone: automation.timezone,
    workspace: {
      name: workspace.name,
      slug: workspace.slug,
      activityApproval: workspace.activityApproval,
      monthlyVoiceReportsEnabled: workspace.monthlyVoiceReportsEnabled,
      monthlyVoiceReportDay: workspace.monthlyVoiceReportDay,
      monthlyVoiceReportHour: workspace.monthlyVoiceReportHour,
      monthlyVoiceLastSentOn: workspace.monthlyVoiceLastSentOn?.toISOString().slice(0, 10) ?? null,
      reportRecipient: workspace.reportRecipient,
    },
  };

  try {
    const result = await deps.ingestion.run({
      pipeline: automation.pipeline,
      runId: run.id,
      workspaceId: automation.workspaceId,
      credentials,
      options,
    });
    await finish({
      status: result.ok ? "success" : "error",
      recordsLoaded: result.recordsLoaded,
      errorMessage: result.ok ? null : truncate(result.error ?? "pipeline failed"),
      notes: result.notes,
    });
  } catch (error) {
    await finish({
      status: "error",
      recordsLoaded: 0,
      errorMessage: truncate(error instanceof Error ? error.message : String(error)),
    });
  }
}
