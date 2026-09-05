import type {
  AvailableRentals,
  EmailCampaignDetail,
  EmailCampaignRow,
  EmailPerformance,
  LeasingSnapshot,
  SocialSnapshot,
  UtilitiesOverview,
  UtilityBillingTarget,
  VoiceCallDetail,
  VoiceCallRow,
  VoiceStats,
  WaterBillGroup,
  WorkspaceActivity,
  WorkspaceChannel,
  WorkspaceContextEntry,
  WorkspaceOverview,
  WorkspacePipe,
  WorkspaceReport,
  WorkspaceReportRow,
  WorkspaceSkill,
  WorkspaceSource,
  WorkspaceSummary,
  WorkspaceSyncRun,
} from "@rakazo/contracts";
import { Prisma, type PrismaClient } from "./client.js";
import { IsolationError, type OrganizationScope } from "./scope.js";
import {
  matchSource,
  type PipeSpec,
  pipeFromFreshness,
  pipeFromRuns,
  pipesForChannels,
  teamFromPipes,
} from "./workspace-pipes.js";

/**
 * Workspace data access: a client's operations warehouse, one per
 * organization. Every read resolves the actor's workspace first and scopes
 * every query by its id; an organization without a workspace sees `null`
 * from `status` and an IsolationError from everything else, the same rule
 * the CRM follows for rows that belong to someone else.
 *
 * Aggregates and day series use tagged-template raw SQL (parameterized);
 * row reads stay in Prisma. All day math is UTC: Prisma stores DateTime as a
 * timestamp without time zone holding the UTC wall clock, so SQL casts like
 * `::date` and `date_trunc` must stay on that plain timestamp (never
 * `at time zone`, which would re-read it in the session TimeZone).
 */

export type WorkspaceActorScope = OrganizationScope;

const CHANNELS: readonly WorkspaceChannel[] = ["voice", "email", "social", "leasing", "utilities"];
const DAY_MS = 86_400_000;

// ── Small helpers ────────────────────────────────────────────────────────────

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;
/** YYYY-MM-DD in UTC; Prisma hands `@db.Date` columns back as UTC midnight. */
const day = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
const utcMidnight = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const addDays = (value: Date, days: number): Date => new Date(value.getTime() + days * DAY_MS);
const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
/** `round(100 * num / den, digits)`, or null when there is nothing to divide by. */
const pct = (num: number, den: number, digits: number): number | null =>
  den ? round((100 * num) / den, digits) : null;
const deltaPct = (current: number, previous: number): number | null =>
  previous ? round((100 * (current - previous)) / previous, 1) : null;
/** "September 2026", the memo month of a bill. */
const monthLabel = (value: Date): string =>
  `${value.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${value.getUTCFullYear()}`;

// ── Row mappers ──────────────────────────────────────────────────────────────

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  channels: string[];
  activityApproval: string;
};

function mapSummary(row: WorkspaceRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    channels: row.channels.filter((channel): channel is WorkspaceChannel =>
      CHANNELS.includes(channel as WorkspaceChannel),
    ),
    activityApproval: row.activityApproval === "auto" ? "auto" : "manual",
  };
}

function mapSource(row: {
  id: string;
  name: string;
  sourceType: string | null;
  status: string;
  lastSyncedAt: Date | null;
}): WorkspaceSource {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.sourceType,
    status: row.status,
    lastSyncedAt: iso(row.lastSyncedAt),
  };
}

function mapSyncRun(row: {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  recordsLoaded: number;
  errorMessage: string | null;
}): WorkspaceSyncRun {
  return {
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    recordsLoaded: row.recordsLoaded,
    errorMessage: row.errorMessage,
  };
}

function mapActivity(row: {
  id: string;
  channel: string;
  kind: string;
  title: string;
  summary: string | null;
  status: string;
  actor: string;
  verification: string;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
}): WorkspaceActivity {
  const verification = row.verification;
  return {
    id: row.id,
    channel: row.channel,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    status: row.status,
    actor: row.actor,
    verification:
      verification === "approved" || verification === "rejected" || verification === "auto"
        ? verification
        : "pending",
    verifiedBy: row.verifiedBy,
    verifiedAt: iso(row.verifiedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

type VoiceCallBase = {
  id: string;
  callerName: string | null;
  callerPhone: string | null;
  callStartedAt: Date | null;
  agentType: string;
  aiResolved: boolean | null;
  callbackRequested: boolean | null;
  analysis: { summary: string | null } | null;
};

function mapVoiceCall(row: VoiceCallBase): VoiceCallRow {
  return {
    id: row.id,
    callerName: row.callerName,
    callerPhone: row.callerPhone,
    callStartedAt: iso(row.callStartedAt),
    agentType: row.agentType,
    aiResolved: row.aiResolved,
    callbackRequested: row.callbackRequested,
    summary: row.analysis?.summary ?? null,
  };
}

function mapReportRow(row: {
  id: string;
  reportType: string;
  title: string;
  status: string;
  dateRangeStart: Date | null;
  dateRangeEnd: Date | null;
  generatedAt: Date | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  sentTo: string | null;
}): WorkspaceReportRow {
  return {
    id: row.id,
    reportType: row.reportType,
    title: row.title,
    status: row.status,
    dateRangeStart: iso(row.dateRangeStart),
    dateRangeEnd: iso(row.dateRangeEnd),
    generatedAt: iso(row.generatedAt),
    approvedAt: iso(row.approvedAt),
    sentAt: iso(row.sentAt),
    sentTo: row.sentTo,
  };
}

type CampaignRowInput = {
  sourceCampaignId: string;
  name: string | null;
  subject: string | null;
  sentAt: Date | null;
  emailsSent: number | null;
  delivered: number | null;
  opens: number | null;
  openPercent: number | null;
  uniqueClicks: number | null;
  bouncePercent: number | null;
  unsubscribes: number | null;
};

function mapCampaignRow(row: CampaignRowInput): EmailCampaignRow {
  return {
    sourceCampaignId: row.sourceCampaignId,
    name: row.name,
    subject: row.subject,
    sentAt: iso(row.sentAt),
    emailsSent: row.emailsSent,
    delivered: row.delivered,
    opens: row.opens,
    openPercent: row.openPercent,
    uniqueClicks: row.uniqueClicks,
    bouncePercent: row.bouncePercent,
    unsubscribes: row.unsubscribes,
  };
}

function mapSkill(row: {
  id: string;
  name: string;
  kind: string;
  version: number;
  content: string;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
}): WorkspaceSkill {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    version: row.version,
    content: row.content,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Repos ────────────────────────────────────────────────────────────────────

/** Injectable clock so tests can pin "now"; production uses the wall clock. */
export type WorkspaceRepoOptions = { now?: () => Date };

export function createWorkspaceRepos(prisma: PrismaClient, options: WorkspaceRepoOptions = {}) {
  const now = options.now ?? (() => new Date());

  async function findWorkspace(actor: WorkspaceActorScope) {
    return prisma.workspace.findUnique({ where: { organizationId: actor.organizationId } });
  }

  async function requireWorkspace(actor: WorkspaceActorScope) {
    const row = await findWorkspace(actor);
    if (!row) throw new IsolationError("No workspace");
    return row;
  }

  // ── Pipes ──────────────────────────────────────────────────────────────

  async function newestTimestamp(
    workspaceId: string,
    mechanism: Extract<PipeSpec["mechanism"], { kind: "freshness" }>,
  ): Promise<Date | null> {
    // The table and column come from the static registry, never from input.
    // `max` skips nulls, so it works for both required and optional timestamps.
    const delegate = prisma[mechanism.table] as unknown as {
      aggregate(args: {
        where: Record<string, unknown>;
        _max: Record<string, true>;
      }): Promise<{ _max: Record<string, unknown> }>;
    };
    const result = await delegate.aggregate({
      where: {
        workspaceId,
        ...(mechanism.filter ? { [mechanism.filter.column]: mechanism.filter.value } : {}),
      },
      _max: { [mechanism.column]: true },
    });
    const value = result._max[mechanism.column];
    return value instanceof Date ? value : null;
  }

  async function loadPipes(workspace: WorkspaceRow): Promise<WorkspacePipe[]> {
    const specs = pipesForChannels(workspace.channels);
    if (specs.length === 0) return [];
    const at = now();
    const sources = await prisma.workspaceSource.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true },
    });
    return Promise.all(
      specs.map(async (spec) => {
        const source = matchSource(spec, sources);
        const sourceId = source?.id ?? null;
        if (source) {
          const runs = await prisma.workspaceSyncRun.findMany({
            where: { workspaceId: workspace.id, sourceId: source.id },
            orderBy: { startedAt: "desc" },
            take: 12,
          });
          if (runs.length > 0) return pipeFromRuns(spec, sourceId, runs.map(mapSyncRun), at);
        }
        if (spec.mechanism.kind === "sync_runs") return pipeFromRuns(spec, sourceId, [], at);
        const lastAt = await newestTimestamp(workspace.id, spec.mechanism);
        return pipeFromFreshness(spec, sourceId, lastAt, at);
      }),
    );
  }

  // ── Utilities (shared by overview) ─────────────────────────────────────

  async function utilitiesOverview(workspaceId: string): Promise<UtilitiesOverview> {
    const properties = await prisma.workspaceUtilityProperty.findMany({
      where: { workspaceId, active: true },
      orderBy: { address: "asc" },
    });
    const propertyIds = [
      ...new Set(properties.map((row) => row.propertyId).filter((id) => id !== null)),
    ];
    const [buildiumProperties, leases, bills] = await Promise.all([
      propertyIds.length
        ? prisma.workspaceBuildiumProperty.findMany({
            where: { workspaceId, propertyId: { in: propertyIds } },
            select: { propertyId: true, addressLine: true },
          })
        : [],
      propertyIds.length
        ? prisma.workspaceBuildiumLease.findMany({
            where: { workspaceId, status: "Active", propertyId: { in: propertyIds } },
            orderBy: { leaseId: "asc" },
          })
        : [],
      prisma.workspaceWaterBill.findMany({
        where: { workspaceId },
        include: { chargePosts: true },
        orderBy: [{ dueDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      }),
    ]);
    const addressByProperty = new Map(
      buildiumProperties.map((row) => [row.propertyId, row.addressLine]),
    );
    const leasesByProperty = new Map<number, typeof leases>();
    for (const lease of leases) {
      if (lease.propertyId === null) continue;
      const list = leasesByProperty.get(lease.propertyId) ?? [];
      list.push(lease);
      leasesByProperty.set(lease.propertyId, list);
    }

    // One target per active utility property, resolved to the lease(s) that carry its charge.
    const targets: (UtilityBillingTarget & { utility: string; addressNorm: string })[] =
      properties.map((property) => {
        const own =
          property.propertyId === null ? [] : (leasesByProperty.get(property.propertyId) ?? []);
        const resolved = own.length === 1 || (own.length > 1 && property.splitEvenly);
        const targetStatus: UtilityBillingTarget["targetStatus"] =
          property.propertyId === null
            ? "unmatched"
            : own.length === 0
              ? "no_active_lease"
              : resolved
                ? "resolved"
                : "ambiguous";
        const chargeShare = own.length === 1 ? 1 : round(1 / own.length, 4);
        return {
          utility: property.utility,
          addressNorm: property.addressNorm,
          utilityPropertyId: property.id,
          address: property.address,
          billingMode: property.billingMode,
          propertyId: property.propertyId,
          buildiumAddress:
            property.propertyId === null
              ? null
              : (addressByProperty.get(property.propertyId) ?? null),
          activeLeaseCount: own.length,
          targetStatus,
          leases: resolved
            ? own.map((lease) => ({
                leaseId: lease.leaseId,
                unitNumber: lease.unitNumber,
                leaseTo: day(lease.leaseTo),
                rent: lease.rent,
                chargeShare,
              }))
            : [],
        };
      });

    const groups: WaterBillGroup[] = bills.map((bill) => {
      const target =
        bill.serviceAddressNorm === null
          ? undefined
          : targets.find(
              (candidate) =>
                candidate.utility === bill.utility &&
                candidate.addressNorm === bill.serviceAddressNorm,
            );
      const memo = bill.billingMonth ? `${monthLabel(bill.billingMonth)} ${bill.utility}` : null;
      return {
        waterBillId: bill.id,
        serviceAddress: bill.serviceAddress,
        billingMonth: day(bill.billingMonth),
        memo,
        dueDate: day(bill.dueDate),
        billAmount: bill.accountBalance,
        parseStatus: bill.parseStatus,
        resolutionStatus: target?.targetStatus ?? "unmatched",
        billingMode: target?.billingMode ?? null,
        charges: (target?.leases ?? []).map((lease) => {
          const post = bill.chargePosts.find((row) => row.leaseId === lease.leaseId);
          const status = post?.status;
          return {
            leaseId: lease.leaseId,
            unitNumber: lease.unitNumber,
            chargeShare: lease.chargeShare,
            chargeAmount:
              bill.accountBalance === null
                ? null
                : round(bill.accountBalance * lease.chargeShare, 2),
            postStatus:
              status === "posted" || status === "skipped" || status === "error"
                ? status
                : "pending",
            postedAmount: post?.amount ?? null,
            postedMemo: post?.memo ?? null,
            buildiumChargeId: post?.buildiumChargeId ?? null,
            postedAt: iso(post?.postedAt),
            postError: post?.error ?? null,
          };
        }),
      };
    });

    return {
      targets: targets.map(({ utility: _utility, addressNorm: _norm, ...target }) => target),
      bills: groups,
    };
  }

  // ── Overview blocks ────────────────────────────────────────────────────

  async function voiceBlock(workspaceId: string): Promise<WorkspaceOverview["voice"]> {
    const since = addDays(now(), -30);
    const rows = await prisma.$queryRaw<
      { agentType: string; calls: number; aiHandled: number; callbacks: number }[]
    >`
      select coalesce("agentType", 'unknown') as "agentType",
             count(*)::int as calls,
             count(*) filter (where "aiResolved")::int as "aiHandled",
             count(*) filter (where "callbackRequested")::int as callbacks
      from workspace_voice_calls
      where "workspaceId" = ${workspaceId} and "callStartedAt" >= ${since}
      group by 1
      order by 2 desc
    `;
    const sum = (key: "calls" | "aiHandled" | "callbacks") =>
      rows.reduce((total, row) => total + row[key], 0);
    return {
      calls30d: sum("calls"),
      aiHandled30d: sum("aiHandled"),
      callbacks30d: sum("callbacks"),
      byAgentType: Object.fromEntries(rows.map((row) => [row.agentType, row.calls])),
    };
  }

  /** Lifetime numbers over sent campaigns, the same rows `emailPerformance("all")` sees. */
  async function emailBlock(workspaceId: string): Promise<WorkspaceOverview["email"]> {
    const [row] = await prisma.$queryRaw<
      { campaigns: number; lastSentAt: Date | null; opens: number; delivered: number }[]
    >`
      select count(*)::int as campaigns,
             max("sentAt") as "lastSentAt",
             coalesce(sum(opens), 0)::int as opens,
             coalesce(sum(delivered), 0)::int as delivered
      from workspace_email_campaigns
      where "workspaceId" = ${workspaceId} and "sentAt" is not null
    `;
    return {
      campaignsTotal: row?.campaigns ?? 0,
      lastCampaignAt: iso(row?.lastSentAt),
      lifetimeOpenRatePct: pct(row?.opens ?? 0, row?.delivered ?? 0, 1),
    };
  }

  async function latestInstagramStats(workspaceId: string) {
    return prisma.workspaceInstagramStats.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async function socialBlock(workspaceId: string): Promise<WorkspaceOverview["social"]> {
    const stats = await latestInstagramStats(workspaceId);
    return {
      instagramUsername: stats?.username ?? null,
      followers: stats?.followers ?? null,
      reach28d: stats?.reach28d ?? null,
      accountsEngaged28d: stats?.accountsEngaged28d ?? null,
    };
  }

  async function leasingBlock(workspaceId: string): Promise<WorkspaceOverview["leasing"]> {
    const [listings, section8, active] = await Promise.all([
      prisma.workspaceBuildiumListing.count({ where: { workspaceId } }),
      prisma.workspaceBuildiumListing.count({ where: { workspaceId, isSection8: true } }),
      prisma.workspaceBuildiumLease.aggregate({
        where: { workspaceId, status: "Active" },
        _count: true,
        _sum: { rent: true },
      }),
    ]);
    return {
      availableListings: listings,
      section8Listings: section8,
      activeLeases: active._count,
      monthlyRentRoll: round(active._sum.rent ?? 0, 2),
    };
  }

  async function utilitiesBlock(workspaceId: string): Promise<WorkspaceOverview["utilities"]> {
    const at = now();
    const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const [billsThisMonth, posts, overview] = await Promise.all([
      prisma.workspaceWaterBill.count({ where: { workspaceId, billingMonth: monthStart } }),
      prisma.workspaceWaterBillChargePost.groupBy({
        by: ["status"],
        where: { workspaceId },
        _count: true,
      }),
      utilitiesOverview(workspaceId),
    ]);
    const postCount = (status: string) => posts.find((row) => row.status === status)?._count ?? 0;
    return {
      billsThisMonth,
      billsNeedingReview: overview.bills.filter(
        (bill) =>
          bill.parseStatus === "needs_review" ||
          bill.resolutionStatus === "unmatched" ||
          bill.resolutionStatus === "ambiguous",
      ).length,
      chargesPending: postCount("pending"),
      chargesPosted: postCount("posted"),
    };
  }

  // ── Public surface ─────────────────────────────────────────────────────

  return {
    async status(actor: WorkspaceActorScope): Promise<{ workspace: WorkspaceSummary | null }> {
      const row = await findWorkspace(actor);
      return { workspace: row ? mapSummary(row) : null };
    },

    async overview(actor: WorkspaceActorScope): Promise<WorkspaceOverview> {
      const workspace = await requireWorkspace(actor);
      const has = (channel: WorkspaceChannel) => workspace.channels.includes(channel);
      const id = workspace.id;
      const [voice, email, social, leasing, utilities, sources, pipes, recentActivity] =
        await Promise.all([
          has("voice") ? voiceBlock(id) : null,
          has("email") ? emailBlock(id) : null,
          has("social") ? socialBlock(id) : null,
          has("leasing") ? leasingBlock(id) : null,
          has("utilities") ? utilitiesBlock(id) : null,
          prisma.workspaceSource.findMany({ where: { workspaceId: id }, orderBy: { name: "asc" } }),
          loadPipes(workspace),
          prisma.workspaceActivity.findMany({
            where: { workspaceId: id },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
        ]);
      return {
        workspace: mapSummary(workspace),
        voice,
        email,
        social,
        leasing,
        utilities,
        sources: sources.map(mapSource),
        pipes,
        team: teamFromPipes(pipes, now()),
        recentActivity: recentActivity.map(mapActivity),
      };
    },

    async system(actor: WorkspaceActorScope): Promise<{ pipes: WorkspacePipe[] }> {
      const workspace = await requireWorkspace(actor);
      return { pipes: await loadPipes(workspace) };
    },

    async voiceStats(
      actor: WorkspaceActorScope,
      input: { days: number; agentType?: string },
    ): Promise<VoiceStats> {
      const workspace = await requireWorkspace(actor);
      const at = now();
      const since = addDays(at, -input.days);
      const previousSince = addDays(at, -2 * input.days);
      const agentFilter = input.agentType
        ? Prisma.sql`and "agentType" = ${input.agentType}`
        : Prisma.empty;
      const [totals] = await prisma.$queryRaw<
        {
          totalCalls: number;
          aiHandled: number;
          callbacksRequested: number;
          prevTotalCalls: number;
          prevAiHandled: number;
          prevCallbacksRequested: number;
        }[]
      >`
        select
          count(*) filter (where "callStartedAt" >= ${since})::int as "totalCalls",
          count(*) filter (where "callStartedAt" >= ${since} and "aiResolved")::int as "aiHandled",
          count(*) filter (where "callStartedAt" >= ${since} and "callbackRequested")::int as "callbacksRequested",
          count(*) filter (where "callStartedAt" >= ${previousSince} and "callStartedAt" < ${since})::int as "prevTotalCalls",
          count(*) filter (where "callStartedAt" >= ${previousSince} and "callStartedAt" < ${since} and "aiResolved")::int as "prevAiHandled",
          count(*) filter (where "callStartedAt" >= ${previousSince} and "callStartedAt" < ${since} and "callbackRequested")::int as "prevCallbacksRequested"
        from workspace_voice_calls
        where "workspaceId" = ${workspace.id} ${agentFilter}
      `;
      const perDay = await prisma.$queryRaw<{ day: string; calls: number; aiHandled: number }[]>`
        select to_char("callStartedAt"::date, 'YYYY-MM-DD') as day,
               count(*)::int as calls,
               count(*) filter (where "aiResolved")::int as "aiHandled"
        from workspace_voice_calls
        where "workspaceId" = ${workspace.id} and "callStartedAt" >= ${since} ${agentFilter}
        group by 1
        order by 1
      `;
      const byDay = new Map(perDay.map((row) => [row.day, row]));
      const daily: VoiceStats["daily"] = [];
      for (let cursor = utcMidnight(since); cursor <= at; cursor = addDays(cursor, 1)) {
        const key = day(cursor)!;
        const row = byDay.get(key);
        daily.push({ day: key, calls: row?.calls ?? 0, aiHandled: row?.aiHandled ?? 0 });
      }
      const total = totals?.totalCalls ?? 0;
      const ai = totals?.aiHandled ?? 0;
      const callbacks = totals?.callbacksRequested ?? 0;
      const previous = {
        totalCalls: totals?.prevTotalCalls ?? 0,
        aiHandled: totals?.prevAiHandled ?? 0,
        callbacksRequested: totals?.prevCallbacksRequested ?? 0,
      };
      return {
        agentType:
          input.agentType === "tenant" || input.agentType === "landlord" ? input.agentType : "all",
        windowDays: input.days,
        totalCalls: total,
        aiHandled: ai,
        aiHandledRatePct: pct(ai, total, 1),
        callbacksRequested: callbacks,
        previousPeriod: previous,
        deltaPct: {
          totalCalls: deltaPct(total, previous.totalCalls),
          aiHandled: deltaPct(ai, previous.aiHandled),
          callbacksRequested: deltaPct(callbacks, previous.callbacksRequested),
        },
        daily,
      };
    },

    async voiceCalls(
      actor: WorkspaceActorScope,
      input: {
        days: number;
        agentType?: string;
        search?: string;
        callbackOnly: boolean;
        limit: number;
      },
    ): Promise<{ calls: VoiceCallRow[] }> {
      const workspace = await requireWorkspace(actor);
      const search = input.search?.trim();
      const rows = await prisma.workspaceVoiceCall.findMany({
        where: {
          workspaceId: workspace.id,
          callStartedAt: { gte: addDays(now(), -input.days) },
          ...(input.agentType ? { agentType: input.agentType } : {}),
          ...(input.callbackOnly ? { callbackRequested: true } : {}),
          ...(search
            ? {
                OR: [
                  { callerName: { contains: search, mode: "insensitive" as const } },
                  { callerPhone: { contains: search, mode: "insensitive" as const } },
                  {
                    analysis: {
                      is: { summary: { contains: search, mode: "insensitive" as const } },
                    },
                  },
                ],
              }
            : {}),
        },
        include: { analysis: { select: { summary: true } } },
        orderBy: { callStartedAt: "desc" },
        take: input.limit,
      });
      return { calls: rows.map(mapVoiceCall) };
    },

    async voiceCall(actor: WorkspaceActorScope, callId: string): Promise<VoiceCallDetail> {
      const workspace = await requireWorkspace(actor);
      const row = await prisma.workspaceVoiceCall.findUnique({
        where: { id: callId },
        include: { analysis: true, transcript: { select: { transcriptText: true } } },
      });
      if (!row || row.workspaceId !== workspace.id) throw new IsolationError();
      return {
        ...mapVoiceCall(row),
        durationSeconds: row.durationSeconds,
        recordingUrl: row.recordingUrl,
        aiResolutionNotes: row.aiResolutionNotes,
        callReason: row.analysis?.callReason ?? null,
        sentiment: row.analysis?.sentiment ?? null,
        followUpRequired: row.analysis?.followUpRequired ?? null,
        tags: row.analysis?.tags ?? [],
        transcript: row.transcript?.transcriptText ?? null,
      };
    },

    async listReports(actor: WorkspaceActorScope): Promise<WorkspaceReportRow[]> {
      const workspace = await requireWorkspace(actor);
      const rows = await prisma.workspaceReport.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ generatedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 200,
      });
      return rows.map(mapReportRow);
    },

    async getReport(actor: WorkspaceActorScope, reportId: string): Promise<WorkspaceReport> {
      const workspace = await requireWorkspace(actor);
      const row = await prisma.workspaceReport.findUnique({ where: { id: reportId } });
      if (!row || row.workspaceId !== workspace.id) throw new IsolationError();
      return { ...mapReportRow(row), summary: row.summary, report: row.report };
    },

    async emailPerformance(
      actor: WorkspaceActorScope,
      input: { window: "12m" | "24m" | "all" },
    ): Promise<EmailPerformance> {
      const workspace = await requireWorkspace(actor);
      const at = now();
      const since =
        input.window === "all"
          ? null
          : new Date(
              Date.UTC(
                at.getUTCFullYear(),
                at.getUTCMonth() - (input.window === "12m" ? 12 : 24),
                at.getUTCDate(),
                at.getUTCHours(),
                at.getUTCMinutes(),
                at.getUTCSeconds(),
              ),
            );
      // Unsent campaigns (null sentAt) are drafts and never count, in any window.
      const sentWindow = since
        ? Prisma.sql`"sentAt" >= ${since}`
        : Prisma.sql`"sentAt" is not null`;
      const [totals] = await prisma.$queryRaw<
        {
          campaigns: number;
          emailsSent: number;
          delivered: number;
          opens: number;
          uniqueClicks: number;
          bounces: number;
          unsubscribes: number;
          hardBounces: number;
          softBounces: number;
          spam: number;
          forwards: number;
          computer: number;
          mobile: number;
          tablet: number;
        }[]
      >`
        select count(*)::int as campaigns,
               coalesce(sum("emailsSent"), 0)::int as "emailsSent",
               coalesce(sum(delivered), 0)::int as delivered,
               coalesce(sum(opens), 0)::int as opens,
               coalesce(sum("uniqueClicks"), 0)::int as "uniqueClicks",
               coalesce(sum(bounces), 0)::int as bounces,
               coalesce(sum(unsubscribes), 0)::int as unsubscribes,
               coalesce(sum("hardBounces"), 0)::int as "hardBounces",
               coalesce(sum("softBounces"), 0)::int as "softBounces",
               coalesce(sum(spam), 0)::int as spam,
               coalesce(sum(forwards), 0)::int as forwards,
               coalesce(sum(nullif("useragentStats"->'device'->>'computer', '')::numeric::int), 0)::int as computer,
               coalesce(sum(nullif("useragentStats"->'device'->>'mobile', '')::numeric::int), 0)::int as mobile,
               coalesce(sum(nullif("useragentStats"->'device'->>'tablet', '')::numeric::int), 0)::int as tablet
        from workspace_email_campaigns
        where "workspaceId" = ${workspace.id} and ${sentWindow}
      `;
      const [recent, topLinks] = await Promise.all([
        prisma.workspaceEmailCampaign.findMany({
          where: { workspaceId: workspace.id, sentAt: since ? { gte: since } : { not: null } },
          orderBy: { sentAt: "desc" },
          take: 50,
        }),
        prisma.$queryRaw<
          { url: string; uniqueClickers: number; totalClicks: number; campaigns: number }[]
        >`
          select l.url,
                 sum(l."uniqueClickers")::int as "uniqueClickers",
                 sum(l."totalClicks")::int as "totalClicks",
                 count(distinct l."sourceCampaignId")::int as campaigns
          from workspace_email_campaign_links l
          join workspace_email_campaigns c
            on c."workspaceId" = l."workspaceId"
           and c."sourceCampaignId" = l."sourceCampaignId"
          where l."workspaceId" = ${workspace.id} and c.${sentWindow}
          group by l.url
          order by 3 desc
          limit 15
        `,
      ]);
      const t = totals ?? {
        campaigns: 0,
        emailsSent: 0,
        delivered: 0,
        opens: 0,
        uniqueClicks: 0,
        bounces: 0,
        unsubscribes: 0,
        hardBounces: 0,
        softBounces: 0,
        spam: 0,
        forwards: 0,
        computer: 0,
        mobile: 0,
        tablet: 0,
      };
      return {
        window: input.window,
        campaignsTotal: t.campaigns,
        emailsSent: t.emailsSent,
        delivered: t.delivered,
        opens: t.opens,
        uniqueClicks: t.uniqueClicks,
        bounces: t.bounces,
        unsubscribes: t.unsubscribes,
        openRatePct: pct(t.opens, t.delivered, 1),
        clickRatePct: pct(t.uniqueClicks, t.delivered, 2),
        recentCampaigns: recent.map(mapCampaignRow),
        topLinks,
        listHealth: {
          hardBounces: t.hardBounces,
          softBounces: t.softBounces,
          spamComplaints: t.spam,
          forwards: t.forwards,
          bounceRatePct: pct(t.bounces, t.emailsSent, 2),
          unsubRatePct: pct(t.unsubscribes, t.delivered, 3),
        },
        deviceSplit: { computer: t.computer, mobile: t.mobile, tablet: t.tablet },
      };
    },

    async emailCampaign(
      actor: WorkspaceActorScope,
      sourceCampaignId: string,
    ): Promise<EmailCampaignDetail> {
      const workspace = await requireWorkspace(actor);
      const row = await prisma.workspaceEmailCampaign.findUnique({
        where: { workspaceId_sourceCampaignId: { workspaceId: workspace.id, sourceCampaignId } },
      });
      if (!row) throw new IsolationError();
      const links = await prisma.workspaceEmailCampaignLink.findMany({
        where: { workspaceId: workspace.id, sourceCampaignId },
        orderBy: { totalClicks: "desc" },
        select: { url: true, uniqueClickers: true, totalClicks: true },
      });
      return {
        ...mapCampaignRow(row),
        fromEmail: row.fromEmail,
        senderName: row.senderName,
        topic: row.topic,
        preheader: row.preheader,
        unopened: row.unopened,
        bounces: row.bounces,
        hardBounces: row.hardBounces,
        softBounces: row.softBounces,
        spam: row.spam,
        forwards: row.forwards,
        deliveredPercent: row.deliveredPercent,
        clickPercent: row.clickPercent,
        clicksPerOpen: row.clicksPerOpen,
        unsubPercent: row.unsubPercent,
        useragentStats: row.useragentStats ?? null,
        links,
      };
    },

    async socialSnapshot(
      actor: WorkspaceActorScope,
      input: { days: number },
    ): Promise<SocialSnapshot> {
      const workspace = await requireWorkspace(actor);
      const sinceDay = addDays(utcMidnight(now()), -input.days);
      const [stats, daily, media] = await Promise.all([
        latestInstagramStats(workspace.id),
        prisma.workspaceInstagramDaily.findMany({
          where: { workspaceId: workspace.id, date: { gte: sinceDay } },
          orderBy: { date: "asc" },
          select: { date: true, reach: true, followers: true, newFollowers: true },
        }),
        prisma.workspaceInstagramMedia.findMany({
          where: { workspaceId: workspace.id },
          orderBy: { reach: { sort: "desc", nulls: "last" } },
          take: 10,
        }),
      ]);
      return {
        windowDays: input.days,
        account: stats
          ? {
              username: stats.username,
              followers: stats.followers,
              follows: stats.follows,
              mediaCount: stats.mediaCount,
              reach28d: stats.reach28d,
              profileViews28d: stats.profileViews28d,
              accountsEngaged28d: stats.accountsEngaged28d,
              totalInteractions28d: stats.totalInteractions28d,
              capturedAt: stats.capturedAt.toISOString(),
            }
          : null,
        daily: daily.map((row) => ({
          day: day(row.date)!,
          reach: row.reach,
          followers: row.followers,
          newFollowers: row.newFollowers,
        })),
        topPosts: media.map((row) => ({
          mediaId: row.mediaId,
          caption: (row.caption ?? "").slice(0, 140),
          permalink: row.permalink,
          mediaType: row.mediaType,
          postedAt: iso(row.postedAt),
          reach: row.reach,
          likes: row.likeCount,
          comments: row.commentsCount,
          totalInteractions: row.totalInteractions,
        })),
      };
    },

    async leasingSnapshot(actor: WorkspaceActorScope): Promise<LeasingSnapshot> {
      const workspace = await requireWorkspace(actor);
      const id = workspace.id;
      const at = now();
      const today = utcMidnight(at);
      const horizon = addDays(today, 90);
      const todayKey = day(today)!;
      const horizonKey = day(horizon)!;
      const [last30d, prior30d, funnelRows, monthly, leaseTotals, upcoming] = await Promise.all([
        prisma.workspaceBuildiumApplication.count({
          where: { workspaceId: id, submittedAt: { gte: addDays(at, -30) } },
        }),
        prisma.workspaceBuildiumApplication.count({
          where: { workspaceId: id, submittedAt: { gte: addDays(at, -60), lt: addDays(at, -30) } },
        }),
        prisma.workspaceBuildiumApplication.groupBy({
          by: ["applicationStatus"],
          where: { workspaceId: id },
          _count: true,
        }),
        prisma.$queryRaw<{ month: string; applications: number }[]>`
          select to_char(date_trunc('month', "submittedAt"), 'YYYY-MM') as month,
                 count(*)::int as applications
          from workspace_buildium_applications
          where "workspaceId" = ${id} and "submittedAt" >= ${addDays(at, -365)}
          group by 1
          order by 1
        `,
        prisma.$queryRaw<
          {
            active: number;
            rentRoll: number;
            avgRent: number | null;
            holdover: number;
            expiring: number;
          }[]
        >`
          select count(*)::int as active,
                 coalesce(sum(rent), 0)::float8 as "rentRoll",
                 round(avg(rent)::numeric)::float8 as "avgRent",
                 count(*) filter (where "leaseTo" < ${todayKey}::date)::int as holdover,
                 count(*) filter (where "leaseTo" >= ${todayKey}::date and "leaseTo" <= ${horizonKey}::date)::int as expiring
          from workspace_buildium_leases
          where "workspaceId" = ${id} and status = 'Active'
        `,
        prisma.workspaceBuildiumLease.findMany({
          where: { workspaceId: id, status: "Active", leaseTo: { gte: today, lte: horizon } },
          orderBy: { leaseTo: "asc" },
          take: 15,
          select: { leaseId: true, propertyId: true, unitNumber: true, leaseTo: true, rent: true },
        }),
      ]);
      const propertyIds = [
        ...new Set(upcoming.flatMap((row) => (row.propertyId == null ? [] : [row.propertyId]))),
      ];
      const properties = propertyIds.length
        ? await prisma.workspaceBuildiumProperty.findMany({
            where: { workspaceId: id, propertyId: { in: propertyIds } },
            select: { propertyId: true, addressLine: true },
          })
        : [];
      const addressByProperty = new Map(properties.map((row) => [row.propertyId, row.addressLine]));
      const funnel = funnelRows
        .map((row) => ({ status: row.applicationStatus ?? "Unknown", count: row._count }))
        .sort((a, b) => b.count - a.count);
      const countOf = (...statuses: string[]) =>
        funnel
          .filter((row) => statuses.includes(row.status))
          .reduce((total, row) => total + row.count, 0);
      const approved = countOf("Approved", "AddedToLease");
      const decided = approved + countOf("Rejected");
      const totals = leaseTotals[0];
      return {
        applications: {
          last30d,
          deltaPctVsPrior30d: deltaPct(last30d, prior30d),
          approvalRatePct: pct(approved, decided, 1),
          funnel,
          monthlySubmissions12m: monthly,
        },
        leases: {
          active: totals?.active ?? 0,
          monthlyRentRoll: round(totals?.rentRoll ?? 0, 2),
          // Deliberately null (not 0) with no active leases; the contract is nullable.
          avgRent: totals?.avgRent ?? null,
          holdover: totals?.holdover ?? 0,
          expiringNext90d: totals?.expiring ?? 0,
          upcomingExpirations: upcoming.map((row) => ({
            leaseId: row.leaseId,
            propertyAddress:
              row.propertyId == null ? null : (addressByProperty.get(row.propertyId) ?? null),
            unitNumber: row.unitNumber,
            leaseTo: day(row.leaseTo)!,
            rent: row.rent,
          })),
        },
      };
    },

    async availableRentals(
      actor: WorkspaceActorScope,
      input: { filter: "all" | "section8" | "market" },
    ): Promise<AvailableRentals> {
      const workspace = await requireWorkspace(actor);
      const rows = await prisma.workspaceBuildiumListing.findMany({
        where: {
          workspaceId: workspace.id,
          ...(input.filter === "section8" ? { isSection8: true } : {}),
          ...(input.filter === "market" ? { isSection8: false } : {}),
        },
        orderBy: [{ availableDate: { sort: "asc", nulls: "last" } }, { rent: "asc" }],
      });
      const rents = rows.map((row) => row.rent).filter((rent): rent is number => Boolean(rent));
      return {
        filter: input.filter,
        count: rows.length,
        section8Count: rows.filter((row) => row.isSection8).length,
        avgRent: rents.length
          ? round(rents.reduce((total, rent) => total + rent, 0) / rents.length, 2)
          : null,
        listings: rows.map((row) => ({
          unitId: row.unitId,
          addressLine: row.addressLine,
          city: row.city,
          state: row.state,
          postalCode: row.postalCode,
          unitNumber: row.unitNumber,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
          rent: row.rent,
          deposit: row.deposit,
          availableDate: day(row.availableDate),
          isSection8: row.isSection8,
          applicationUrl: row.applicationUrl,
        })),
      };
    },

    async utilitiesOverview(actor: WorkspaceActorScope): Promise<UtilitiesOverview> {
      const workspace = await requireWorkspace(actor);
      return utilitiesOverview(workspace.id);
    },

    async listActivities(
      actor: WorkspaceActorScope,
      input: { channel?: string; limit: number },
    ): Promise<WorkspaceActivity[]> {
      const workspace = await requireWorkspace(actor);
      const rows = await prisma.workspaceActivity.findMany({
        where: { workspaceId: workspace.id, ...(input.channel ? { channel: input.channel } : {}) },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
      return rows.map(mapActivity);
    },

    /** The newest version of every skill. */
    async listSkills(actor: WorkspaceActorScope): Promise<Omit<WorkspaceSkill, "content">[]> {
      const workspace = await requireWorkspace(actor);
      const rows = await prisma.workspaceSkill.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ name: "asc" }, { version: "desc" }],
        distinct: ["name"],
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        version: row.version,
        notes: row.notes,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
      }));
    },

    async getSkill(
      actor: WorkspaceActorScope,
      input: { name: string; version?: number },
    ): Promise<WorkspaceSkill> {
      const workspace = await requireWorkspace(actor);
      const row = await prisma.workspaceSkill.findFirst({
        where: {
          workspaceId: workspace.id,
          name: input.name,
          ...(input.version === undefined ? {} : { version: input.version }),
        },
        orderBy: { version: "desc" },
      });
      if (!row) throw new IsolationError("Skill not found");
      return mapSkill(row);
    },

    async listContext(actor: WorkspaceActorScope): Promise<WorkspaceContextEntry[]> {
      const workspace = await requireWorkspace(actor);
      const rows = await prisma.workspaceContext.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { key: "asc" },
      });
      return rows.map((row) => ({
        key: row.key,
        content: row.content,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
  };
}

export type WorkspaceRepos = ReturnType<typeof createWorkspaceRepos>;
