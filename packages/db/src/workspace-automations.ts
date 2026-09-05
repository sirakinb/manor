import type {
  WorkspaceAutomation,
  WorkspaceAutomationKey,
  WorkspaceChannel,
  WorkspaceSyncRun,
} from "@rakazo/contracts";
import { nextCronDateAcrossStrict } from "@rakazo/core";
import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";
import { computePipeStatus, WORKSPACE_PIPES } from "./workspace-pipes.js";

/**
 * The automation registry: which pipeline each channel runs, how often, and
 * which stored credentials it needs. Keyed by channel like the pipe registry;
 * an automation's key is the pipe key it feeds, so System and Overview can
 * show real runs next to the pipe.
 *
 * Cadences follow the old schedules. The service self-gates the ones that
 * fire more often than they act (water's month-end sweep, the hourly recap
 * tick), so Manor only has to wake them.
 */

export interface AutomationSpec {
  defaultEnabled?: boolean;
  key: WorkspaceAutomationKey;
  channel: WorkspaceChannel;
  label: string;
  /** What the ingestion service runs. */
  pipeline: string;
  crons: string[];
  /** Workspace credential providers the pipeline needs; a missing one fails the run before calling out. */
  credentials: string[];
  /** The workspace_sources row the run is recorded against (created when missing); null for internal pipelines. */
  sourceName: string | null;
  sourceType: string | null;
}

export const DEFAULT_AUTOMATION_TIMEZONE = "America/New_York";

export const WORKSPACE_AUTOMATIONS: readonly AutomationSpec[] = [
  {
    key: "email-recap",
    channel: "email",
    label: "Weekly email recap",
    pipeline: "email-recap",
    crons: ["0 * * * *"],
    credentials: ["openrouter"],
    sourceName: null,
    sourceType: null,
    defaultEnabled: false,
  },
  {
    key: "voice",
    channel: "voice",
    label: "Voice calls",
    pipeline: "zoho-agent-logs",
    crons: ["*/10 * * * *"],
    credentials: ["zoho-crm"],
    sourceName: "Zoho CRM",
    sourceType: "voice",
  },
  {
    key: "email",
    channel: "email",
    label: "Email campaigns",
    pipeline: "zoho-campaigns",
    crons: ["0 9 * * *"],
    credentials: ["zoho-campaigns"],
    sourceName: "Zoho Campaigns",
    sourceType: "email",
  },
  {
    key: "instagram",
    channel: "social",
    label: "Instagram insights",
    pipeline: "instagram",
    crons: ["0 * * * *"],
    credentials: ["instagram"],
    sourceName: "Instagram",
    sourceType: "social",
  },
  {
    key: "buildium",
    channel: "leasing",
    label: "Leasing",
    pipeline: "buildium",
    crons: ["0 6 * * *"],
    credentials: ["buildium"],
    sourceName: "Buildium",
    sourceType: "leasing",
  },
  {
    key: "listings",
    channel: "leasing",
    label: "Listings",
    pipeline: "listings",
    crons: ["30 6 * * *"],
    credentials: [],
    sourceName: "Listings",
    sourceType: "leasing",
  },
  {
    key: "water",
    channel: "utilities",
    label: "Water bills",
    pipeline: "water",
    // Weekly on Monday, plus a daily month-end sweep the service gates itself.
    crons: ["0 8 * * 1", "0 8 26-29 * *"],
    credentials: ["gmail"],
    sourceName: "Gmail",
    sourceType: "utilities",
  },
  {
    key: "recap",
    channel: "voice",
    label: "Monthly recap",
    pipeline: "recap",
    // Hourly tick; the service only generates on the configured day and hour.
    crons: ["0 * * * *"],
    credentials: ["openrouter"],
    sourceName: null,
    sourceType: null,
  },
];

export function automationSpec(key: string): AutomationSpec | undefined {
  return WORKSPACE_AUTOMATIONS.find((spec) => spec.key === key);
}

export function automationsForChannels(channels: readonly string[]): AutomationSpec[] {
  return WORKSPACE_AUTOMATIONS.filter((spec) => channels.includes(spec.channel));
}

/** The next wakeup after `from`, or null when no cron parses (the automation then pauses). */
export function automationNextRunAt(crons: string[], timezone: string, from: Date): Date | null {
  return nextCronDateAcrossStrict(crons, from, timezone);
}

type AutomationRow = {
  id: string;
  workspaceId: string;
  key: string;
  label: string;
  pipeline: string;
  crons: string[];
  timezone: string;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
};

type RunRow = {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  recordsLoaded: number;
  errorMessage: string | null;
};

function mapRun(row: RunRow): WorkspaceSyncRun {
  return {
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    recordsLoaded: row.recordsLoaded,
    errorMessage: row.errorMessage,
  };
}

/** The same judgement the pipe registry makes, from the newest run and the pipe's threshold. */
export function automationStatus(
  row: Pick<AutomationRow, "key" | "enabled" | "lastRunAt">,
  lastRun: RunRow | null,
  now: Date,
): WorkspaceAutomation["status"] {
  const pipe = WORKSPACE_PIPES.find((candidate) => candidate.key === row.key);
  const maxAgeHours = pipe?.maxAgeHours ?? 24;
  const lastAt = lastRun?.startedAt ?? row.lastRunAt;
  return computePipeStatus({ maxAgeHours }, lastAt, lastRun?.status === "error", now);
}

function mapAutomation(
  row: AutomationRow,
  spec: AutomationSpec,
  lastRun: RunRow | null,
  now: Date,
): WorkspaceAutomation {
  return {
    key: spec.key,
    label: row.label,
    channel: spec.channel,
    pipeline: row.pipeline,
    crons: row.crons,
    timezone: row.timezone,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastRun: lastRun ? mapRun(lastRun) : null,
    status: automationStatus(row, lastRun, now),
  };
}

/**
 * Seed the registry's automations for a workspace's channels. Idempotent:
 * existing rows keep their schedule and enabled flag; only missing keys are
 * created, armed with their first wakeup.
 */
export async function ensureDefaultAutomations(
  prisma: PrismaClient,
  workspace: { id: string; channels: string[] },
  now = new Date(),
): Promise<void> {
  const existing = await prisma.workspaceAutomation.findMany({
    where: { workspaceId: workspace.id },
    select: { key: true },
  });
  const present = new Set(existing.map((row) => row.key));
  const missing = automationsForChannels(workspace.channels).filter(
    (spec) => !present.has(spec.key),
  );
  if (missing.length === 0) return;
  await prisma.workspaceAutomation.createMany({
    data: missing.map((spec) => ({
      workspaceId: workspace.id,
      key: spec.key,
      label: spec.label,
      pipeline: spec.pipeline,
      crons: spec.crons,
      timezone: DEFAULT_AUTOMATION_TIMEZONE,
      enabled: spec.defaultEnabled ?? true,
      nextRunAt:
        spec.defaultEnabled === false
          ? null
          : automationNextRunAt(spec.crons, DEFAULT_AUTOMATION_TIMEZONE, now),
    })),
    skipDuplicates: true,
  });
}

export async function listWorkspaceAutomations(
  prisma: PrismaClient,
  workspaceId: string,
  now = new Date(),
): Promise<WorkspaceAutomation[]> {
  const rows = await prisma.workspaceAutomation.findMany({
    where: { workspaceId },
    include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
  });
  const order = new Map(WORKSPACE_AUTOMATIONS.map((spec, index) => [spec.key, index]));
  return rows
    .flatMap((row) => {
      const spec = automationSpec(row.key);
      return spec ? [mapAutomation(row, spec, row.runs[0] ?? null, now)] : [];
    })
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

export async function requireWorkspaceAutomation(
  prisma: PrismaClient,
  workspaceId: string,
  key: string,
) {
  const row = await prisma.workspaceAutomation.findUnique({
    where: { workspaceId_key: { workspaceId, key } },
  });
  if (!row) throw new IsolationError("No such automation");
  return row;
}

/**
 * Change the schedule or pause an automation. Crons are validated strictly
 * before they are saved; the next wakeup is recomputed whenever the schedule
 * or the enabled flag changes.
 */
export async function updateWorkspaceAutomation(
  prisma: PrismaClient,
  workspaceId: string,
  input: { key: string; enabled?: boolean; crons?: string[] },
  now = new Date(),
): Promise<WorkspaceAutomation> {
  const row = await requireWorkspaceAutomation(prisma, workspaceId, input.key);
  const spec = automationSpec(row.key);
  if (!spec) throw new IsolationError("No such automation");
  const crons = input.crons ?? row.crons;
  const enabled = input.enabled ?? row.enabled;
  if (input.crons) automationNextRunAt(crons, row.timezone, now); // throws on a malformed cron
  const scheduleChanged =
    input.crons !== undefined && input.crons.join("\n") !== row.crons.join("\n");
  const nextRunAt = !enabled
    ? null
    : scheduleChanged || !row.nextRunAt
      ? automationNextRunAt(crons, row.timezone, now)
      : row.nextRunAt;
  const updated = await prisma.workspaceAutomation.update({
    where: { id: row.id },
    data: { crons, enabled, nextRunAt },
    include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
  });
  return mapAutomation(updated, spec, updated.runs[0] ?? null, now);
}
