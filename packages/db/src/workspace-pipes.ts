import type {
  WorkspaceChannel,
  WorkspacePipe,
  WorkspacePipeStatus,
  WorkspaceSyncRun,
  WorkspaceTeamWorker,
} from "@rakazo/contracts";

/**
 * The pipeline registry: which sources feed which channel, how often, and how
 * we know a pipe is alive. Keyed by channel, so a workspace gets the pipes of
 * the channels it has and nothing else. Everything here is pure; the loader in
 * workspace.ts supplies the timestamps.
 *
 * Two honest freshness signals:
 *  - "sync_runs": the pipe records runs, so we can show history and failures.
 *  - "freshness": the newest synced timestamp in the landing table stands in.
 *    It can say flowing or overdue, never failing.
 */

/** Prisma delegate names a freshness probe may read. */
export type FreshnessTable =
  | "workspaceVoiceCall"
  | "workspaceEmailCampaign"
  | "workspaceInstagramStats"
  | "workspaceBuildiumLease"
  | "workspaceWaterBill"
  | "workspaceRemaListing"
  | "workspaceReport";

export type PipeMechanism =
  | {
      kind: "freshness";
      table: FreshnessTable;
      column: string;
      filter?: { column: string; value: string };
    }
  | { kind: "sync_runs"; sourceName: string };

export interface PipeSpec {
  key: string;
  label: string;
  source: string;
  channel: WorkspaceChannel;
  cadence: string;
  /** Older than this means overdue. */
  maxAgeHours: number;
  mechanism: PipeMechanism;
  /**
   * Lower-cased `workspace_sources.name` values that belong to this pipe,
   * matched case-insensitively on the full name. A matching row becomes the
   * pipe's `sourceId`; when it also has sync runs, those replace the
   * freshness probe.
   */
  sourceNames: string[];
  /** True for pipes that run on data already in the vault (no external source). */
  internal: boolean;
}

export const WORKSPACE_PIPES: readonly PipeSpec[] = [
  {
    key: "email-recap",
    label: "Weekly email recap",
    source: "Campaign rollup",
    channel: "email",
    cadence: "weekly",
    maxAgeHours: 24 * 8,
    mechanism: {
      kind: "freshness",
      table: "workspaceReport",
      column: "generatedAt",
      filter: { column: "reportType", value: "email" },
    },
    sourceNames: [],
    internal: true,
  },
  {
    key: "voice",
    label: "Voice calls",
    source: "Zoho CRM",
    channel: "voice",
    cadence: "every 10 min",
    // Data-dependent: updates only when calls happen, so the threshold is generous.
    maxAgeHours: 72,
    mechanism: { kind: "freshness", table: "workspaceVoiceCall", column: "updatedAt" },
    sourceNames: ["retell", "zoho crm", "zoho"],
    internal: false,
  },
  {
    key: "email",
    label: "Email campaigns",
    source: "Zoho Campaigns",
    channel: "email",
    cadence: "daily",
    maxAgeHours: 36,
    mechanism: { kind: "freshness", table: "workspaceEmailCampaign", column: "statsSyncedAt" },
    sourceNames: ["zoho campaigns"],
    internal: false,
  },
  {
    key: "instagram",
    label: "Instagram insights",
    source: "Meta Graph API",
    channel: "social",
    cadence: "hourly",
    maxAgeHours: 4,
    mechanism: { kind: "freshness", table: "workspaceInstagramStats", column: "updatedAt" },
    sourceNames: ["instagram", "meta graph api"],
    internal: false,
  },
  {
    key: "buildium",
    label: "Leasing",
    source: "Buildium API",
    channel: "leasing",
    cadence: "daily",
    // Upserts touch rows only on change; leases can be quiet for days.
    maxAgeHours: 24 * 7,
    mechanism: { kind: "freshness", table: "workspaceBuildiumLease", column: "updatedAt" },
    sourceNames: ["buildium"],
    internal: false,
  },
  {
    key: "listings",
    label: "Listings",
    source: "REMA + availability sheet",
    channel: "leasing",
    cadence: "daily",
    maxAgeHours: 48,
    mechanism: { kind: "freshness", table: "workspaceRemaListing", column: "scrapedAt" },
    sourceNames: ["listings", "rema"],
    internal: false,
  },
  {
    key: "water",
    label: "Water bills",
    source: "PHL Water / Gmail",
    channel: "utilities",
    cadence: "weekly + month-end",
    maxAgeHours: 24 * 16,
    mechanism: { kind: "freshness", table: "workspaceWaterBill", column: "createdAt" },
    sourceNames: ["gmail", "wrd"],
    internal: false,
  },
  {
    key: "recap",
    label: "Monthly recap",
    source: "Voice rollup",
    channel: "voice",
    cadence: "monthly",
    maxAgeHours: 24 * 35,
    mechanism: {
      kind: "freshness",
      table: "workspaceReport",
      column: "generatedAt",
      filter: { column: "reportType", value: "voice_monthly" },
    },
    sourceNames: [],
    internal: true,
  },
];

interface WorkerSpec {
  key: string;
  name: string;
  role: string;
  channel: WorkspaceChannel;
  /** Registry pipe keys this worker rolls up. */
  pipeKeys: string[];
}

/** The pipes as the client sees them: members of their AI team, in plain words. */
export const WORKSPACE_WORKERS: readonly WorkerSpec[] = [
  {
    key: "call-logger",
    name: "Call logger",
    role: "Records every AI phone call with transcript and analysis",
    channel: "voice",
    pipeKeys: ["voice"],
  },
  {
    key: "email-tracker",
    name: "Email tracker",
    role: "Tracks campaign delivery, opens, and clicks from Zoho",
    channel: "email",
    pipeKeys: ["email"],
  },
  {
    key: "social-monitor",
    name: "Social monitor",
    role: "Pulls Instagram reach, followers, and post stats",
    channel: "social",
    pipeKeys: ["instagram"],
  },
  {
    key: "leasing-sync",
    name: "Leasing sync",
    role: "Keeps applications, leases, and listings current from Buildium",
    channel: "leasing",
    pipeKeys: ["buildium", "listings"],
  },
  {
    key: "water-clerk",
    name: "Water-bill clerk",
    role: "Reads WRD bills from email and prepares Buildium charges for approval",
    channel: "utilities",
    pipeKeys: ["water"],
  },
];

const HOUR_MS = 3_600_000;

export function pipesForChannels(channels: readonly string[]): PipeSpec[] {
  return WORKSPACE_PIPES.filter((pipe) => channels.includes(pipe.channel));
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

export function computePipeStatus(
  spec: Pick<PipeSpec, "maxAgeHours">,
  lastAt: Date | null,
  lastFailed: boolean,
  now: Date,
): WorkspacePipeStatus {
  if (lastFailed) return "failing";
  if (!lastAt) return "idle";
  if (hoursBetween(lastAt, now) > spec.maxAgeHours) return "overdue";
  return "flowing";
}

function pipeBase(spec: PipeSpec, sourceId: string | null, automationKey: string | null) {
  return {
    key: spec.key,
    label: spec.label,
    source: spec.source,
    sourceId,
    internal: spec.internal,
    automationKey,
    channel: spec.channel,
    cadence: spec.cadence,
  };
}

/** The registered source row a pipe reads from, by case-insensitive full name. */
export function matchSource<T extends { name: string }>(spec: PipeSpec, sources: T[]): T | null {
  const names =
    spec.mechanism.kind === "sync_runs"
      ? [spec.mechanism.sourceName.toLowerCase(), ...spec.sourceNames]
      : spec.sourceNames;
  return sources.find((source) => names.includes(source.name.trim().toLowerCase())) ?? null;
}

/** A pipe judged by its recorded runs, newest first. */
/** Where a pipe's signal comes from: the automation driving it, its source row, or neither. */
export type PipeBinding = { sourceId: string | null; automationKey: string | null };

export function pipeFromRuns(
  spec: PipeSpec,
  binding: PipeBinding,
  runs: WorkspaceSyncRun[],
  now: Date,
): WorkspacePipe {
  const last = runs[0] ?? null;
  const lastAt = last ? new Date(last.startedAt) : null;
  const failed = last?.status === "error";
  return {
    ...pipeBase(spec, binding.sourceId, binding.automationKey),
    status: computePipeStatus(spec, lastAt, failed, now),
    lastAt: lastAt?.toISOString() ?? null,
    ageHours: lastAt ? hoursBetween(lastAt, now) : null,
    lastRecords: last?.recordsLoaded ?? null,
    lastError: failed ? (last?.errorMessage ?? null) : null,
    runs,
  };
}

/** A pipe judged only by the newest timestamp in its landing table. */
export function pipeFromFreshness(
  spec: PipeSpec,
  binding: PipeBinding,
  lastAt: Date | null,
  now: Date,
): WorkspacePipe {
  return {
    ...pipeBase(spec, binding.sourceId, binding.automationKey),
    status: computePipeStatus(spec, lastAt, false, now),
    lastAt: lastAt?.toISOString() ?? null,
    ageHours: lastAt ? hoursBetween(lastAt, now) : null,
    lastRecords: null,
    lastError: null,
    runs: [],
  };
}

export function workerStatus(
  pipes: Pick<WorkspacePipe, "status">[],
  lastAt: Date | null,
  now: Date,
): WorkspaceTeamWorker["status"] {
  if (pipes.every((pipe) => pipe.status === "idle")) return "setting_up";
  // Client-safe: overdue and failing both read "catching up"; System carries the diagnosis.
  if (pipes.some((pipe) => pipe.status === "overdue" || pipe.status === "failing")) {
    return "catching_up";
  }
  if (lastAt && now.getTime() - lastAt.getTime() < HOUR_MS) return "working";
  return "fresh";
}

/** Roll computed pipes up into the client-facing team, one worker per channel present. */
export function teamFromPipes(pipes: WorkspacePipe[], now: Date): WorkspaceTeamWorker[] {
  const byKey = new Map(pipes.map((pipe) => [pipe.key, pipe]));
  const workers: WorkspaceTeamWorker[] = [];
  for (const spec of WORKSPACE_WORKERS) {
    const own = spec.pipeKeys.map((key) => byKey.get(key)).filter((pipe) => pipe !== undefined);
    if (own.length === 0) continue;
    const lastIso =
      own
        .map((pipe) => pipe.lastAt)
        .filter((at) => at !== null)
        .sort()
        .at(-1) ?? null;
    const lastAt = lastIso ? new Date(lastIso) : null;
    workers.push({
      key: spec.key,
      name: spec.name,
      role: spec.role,
      channel: spec.channel,
      status: workerStatus(own, lastAt, now),
      lastAt: lastIso,
      cadence: own[0]?.cadence ?? "scheduled",
    });
  }
  return workers;
}
