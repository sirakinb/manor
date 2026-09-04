import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

// ── Workspace ────────────────────────────────────────────────────────────────
// A client's operations warehouse, one per organization. The Workspace place
// in the web app draws its pipeline map from `overview` and opens one section
// panel per channel from the finer-grained reads below. Everything here is a
// read; write paths (approvals, posting charges, reports) come with the
// ingestion move.

export const WORKSPACE_CHANNELS = ["voice", "email", "social", "leasing", "utilities"] as const;
export const WorkspaceChannelSchema = z.enum(WORKSPACE_CHANNELS);
export type WorkspaceChannel = z.infer<typeof WorkspaceChannelSchema>;

export const VOICE_AGENT_TYPES = ["tenant", "landlord"] as const;
export const VoiceAgentTypeSchema = z.enum(VOICE_AGENT_TYPES);
export type VoiceAgentType = z.infer<typeof VoiceAgentTypeSchema>;

/// A calendar day as YYYY-MM-DD; the warehouse keeps day-grained series.
export const DayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const WorkspaceSummarySchema = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  channels: z.array(WorkspaceChannelSchema),
  activityApproval: z.enum(["manual", "auto"]),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const WorkspaceSourceSchema = z.object({
  id: Id,
  name: z.string(),
  sourceType: z.string().nullable(),
  status: z.string(),
  lastSyncedAt: IsoDate.nullable(),
});
export type WorkspaceSource = z.infer<typeof WorkspaceSourceSchema>;

export const WORKSPACE_PIPE_STATUSES = ["flowing", "overdue", "failing", "idle"] as const;
export const WorkspacePipeStatusSchema = z.enum(WORKSPACE_PIPE_STATUSES);
export type WorkspacePipeStatus = z.infer<typeof WorkspacePipeStatusSchema>;

export const WorkspaceSyncRunSchema = z.object({
  status: z.string(),
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
  recordsLoaded: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
});
export type WorkspaceSyncRun = z.infer<typeof WorkspaceSyncRunSchema>;

/// One edge of the pipeline map: a source feeding a channel, with freshness.
export const WorkspacePipeSchema = z.object({
  key: z.string(),
  label: z.string(),
  source: z.string(),
  /// The workspace_sources row this pipe reads from, when one is registered.
  sourceId: Id.nullable(),
  /// True for pipes that run on data already in the vault (no external source).
  internal: z.boolean(),
  channel: WorkspaceChannelSchema,
  cadence: z.string(),
  status: WorkspacePipeStatusSchema,
  lastAt: IsoDate.nullable(),
  ageHours: z.number().nullable(),
  lastRecords: z.number().int().nullable(),
  lastError: z.string().nullable(),
  runs: z.array(WorkspaceSyncRunSchema),
});
export type WorkspacePipe = z.infer<typeof WorkspacePipeSchema>;

export const WORKSPACE_WORKER_STATUSES = ["working", "fresh", "catching_up", "setting_up"] as const;
export const WorkspaceWorkerStatusSchema = z.enum(WORKSPACE_WORKER_STATUSES);

/// A pipe as the client sees it: a member of their AI team, in plain words.
export const WorkspaceTeamWorkerSchema = z.object({
  key: z.string(),
  name: z.string(),
  role: z.string(),
  channel: WorkspaceChannelSchema,
  status: WorkspaceWorkerStatusSchema,
  lastAt: IsoDate.nullable(),
  cadence: z.string(),
});
export type WorkspaceTeamWorker = z.infer<typeof WorkspaceTeamWorkerSchema>;

export const WorkspaceActivitySchema = z.object({
  id: Id,
  channel: z.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  status: z.string(),
  actor: z.string(),
  verification: z.enum(["pending", "approved", "rejected", "auto"]),
  verifiedBy: z.string().nullable(),
  verifiedAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export type WorkspaceActivity = z.infer<typeof WorkspaceActivitySchema>;

export const WorkspaceOverviewSchema = z.object({
  workspace: WorkspaceSummarySchema,
  voice: z
    .object({
      calls30d: z.number().int(),
      aiHandled30d: z.number().int(),
      callbacks30d: z.number().int(),
      byAgentType: z.record(z.string(), z.number().int()),
    })
    .nullable(),
  email: z
    .object({
      campaignsTotal: z.number().int(),
      lastCampaignAt: IsoDate.nullable(),
      lifetimeOpenRatePct: z.number().nullable(),
    })
    .nullable(),
  social: z
    .object({
      instagramUsername: z.string().nullable(),
      followers: z.number().int().nullable(),
      reach28d: z.number().int().nullable(),
      accountsEngaged28d: z.number().int().nullable(),
    })
    .nullable(),
  leasing: z
    .object({
      availableListings: z.number().int(),
      section8Listings: z.number().int(),
      activeLeases: z.number().int(),
      monthlyRentRoll: z.number(),
    })
    .nullable(),
  utilities: z
    .object({
      billsThisMonth: z.number().int(),
      billsNeedingReview: z.number().int(),
      chargesPending: z.number().int(),
      chargesPosted: z.number().int(),
    })
    .nullable(),
  sources: z.array(WorkspaceSourceSchema),
  pipes: z.array(WorkspacePipeSchema),
  team: z.array(WorkspaceTeamWorkerSchema),
  recentActivity: z.array(WorkspaceActivitySchema),
});
export type WorkspaceOverview = z.infer<typeof WorkspaceOverviewSchema>;

// ── Voice ────────────────────────────────────────────────────────────────────

export const VoiceStatsSchema = z.object({
  agentType: z.enum(["tenant", "landlord", "all"]),
  windowDays: z.number().int(),
  totalCalls: z.number().int(),
  aiHandled: z.number().int(),
  aiHandledRatePct: z.number().nullable(),
  callbacksRequested: z.number().int(),
  previousPeriod: z.object({
    totalCalls: z.number().int(),
    aiHandled: z.number().int(),
    callbacksRequested: z.number().int(),
  }),
  deltaPct: z.object({
    totalCalls: z.number().nullable(),
    aiHandled: z.number().nullable(),
    callbacksRequested: z.number().nullable(),
  }),
  daily: z.array(
    z.object({ day: DayString, calls: z.number().int(), aiHandled: z.number().int() }),
  ),
});
export type VoiceStats = z.infer<typeof VoiceStatsSchema>;

export const VoiceCallRowSchema = z.object({
  id: Id,
  callerName: z.string().nullable(),
  callerPhone: z.string().nullable(),
  callStartedAt: IsoDate.nullable(),
  agentType: z.string(),
  aiResolved: z.boolean().nullable(),
  callbackRequested: z.boolean().nullable(),
  summary: z.string().nullable(),
});
export type VoiceCallRow = z.infer<typeof VoiceCallRowSchema>;

export const VoiceCallDetailSchema = VoiceCallRowSchema.extend({
  durationSeconds: z.number().int().nullable(),
  recordingUrl: z.string().nullable(),
  aiResolutionNotes: z.string().nullable(),
  callReason: z.string().nullable(),
  sentiment: z.string().nullable(),
  followUpRequired: z.boolean().nullable(),
  tags: z.array(z.string()),
  transcript: z.string().nullable(),
});
export type VoiceCallDetail = z.infer<typeof VoiceCallDetailSchema>;

// ── Reports ──────────────────────────────────────────────────────────────────

export const WorkspaceReportRowSchema = z.object({
  id: Id,
  reportType: z.string(),
  title: z.string(),
  status: z.string(),
  dateRangeStart: IsoDate.nullable(),
  dateRangeEnd: IsoDate.nullable(),
  generatedAt: IsoDate.nullable(),
  approvedAt: IsoDate.nullable(),
  sentAt: IsoDate.nullable(),
  sentTo: z.string().nullable(),
});
export type WorkspaceReportRow = z.infer<typeof WorkspaceReportRowSchema>;

export const WorkspaceReportSchema = WorkspaceReportRowSchema.extend({
  summary: z.string().nullable(),
  report: z.unknown(),
});
export type WorkspaceReport = z.infer<typeof WorkspaceReportSchema>;

// ── Email ────────────────────────────────────────────────────────────────────

export const EMAIL_WINDOWS = ["12m", "24m", "all"] as const;
export const EmailWindowSchema = z.enum(EMAIL_WINDOWS);

export const EmailCampaignRowSchema = z.object({
  sourceCampaignId: z.string(),
  name: z.string().nullable(),
  subject: z.string().nullable(),
  sentAt: IsoDate.nullable(),
  emailsSent: z.number().int().nullable(),
  delivered: z.number().int().nullable(),
  opens: z.number().int().nullable(),
  openPercent: z.number().nullable(),
  uniqueClicks: z.number().int().nullable(),
  bouncePercent: z.number().nullable(),
  unsubscribes: z.number().int().nullable(),
});
export type EmailCampaignRow = z.infer<typeof EmailCampaignRowSchema>;

export const EmailPerformanceSchema = z.object({
  window: EmailWindowSchema,
  campaignsTotal: z.number().int(),
  emailsSent: z.number().int(),
  delivered: z.number().int(),
  opens: z.number().int(),
  uniqueClicks: z.number().int(),
  bounces: z.number().int(),
  unsubscribes: z.number().int(),
  openRatePct: z.number().nullable(),
  clickRatePct: z.number().nullable(),
  recentCampaigns: z.array(EmailCampaignRowSchema),
  topLinks: z.array(
    z.object({
      url: z.string(),
      uniqueClickers: z.number().int(),
      totalClicks: z.number().int(),
      campaigns: z.number().int(),
    }),
  ),
  listHealth: z.object({
    hardBounces: z.number().int(),
    softBounces: z.number().int(),
    spamComplaints: z.number().int(),
    forwards: z.number().int(),
    bounceRatePct: z.number().nullable(),
    unsubRatePct: z.number().nullable(),
  }),
  deviceSplit: z.object({
    computer: z.number().int(),
    mobile: z.number().int(),
    tablet: z.number().int(),
  }),
});
export type EmailPerformance = z.infer<typeof EmailPerformanceSchema>;

export const EmailCampaignDetailSchema = EmailCampaignRowSchema.extend({
  fromEmail: z.string().nullable(),
  senderName: z.string().nullable(),
  topic: z.string().nullable(),
  preheader: z.string().nullable(),
  unopened: z.number().int().nullable(),
  bounces: z.number().int().nullable(),
  hardBounces: z.number().int().nullable(),
  softBounces: z.number().int().nullable(),
  spam: z.number().int().nullable(),
  forwards: z.number().int().nullable(),
  deliveredPercent: z.number().nullable(),
  clickPercent: z.number().nullable(),
  clicksPerOpen: z.number().nullable(),
  unsubPercent: z.number().nullable(),
  useragentStats: z.unknown().nullable(),
  links: z.array(
    z.object({ url: z.string(), uniqueClickers: z.number().int(), totalClicks: z.number().int() }),
  ),
});
export type EmailCampaignDetail = z.infer<typeof EmailCampaignDetailSchema>;

// ── Social ───────────────────────────────────────────────────────────────────

export const SocialSnapshotSchema = z.object({
  windowDays: z.number().int(),
  account: z
    .object({
      username: z.string().nullable(),
      followers: z.number().int().nullable(),
      follows: z.number().int().nullable(),
      mediaCount: z.number().int().nullable(),
      reach28d: z.number().int().nullable(),
      profileViews28d: z.number().int().nullable(),
      accountsEngaged28d: z.number().int().nullable(),
      totalInteractions28d: z.number().int().nullable(),
      capturedAt: IsoDate,
    })
    .nullable(),
  daily: z.array(
    z.object({
      day: DayString,
      reach: z.number().int().nullable(),
      followers: z.number().int().nullable(),
    }),
  ),
  topPosts: z.array(
    z.object({
      mediaId: z.string(),
      caption: z.string(),
      permalink: z.string().nullable(),
      mediaType: z.string().nullable(),
      postedAt: IsoDate.nullable(),
      reach: z.number().int().nullable(),
      likes: z.number().int().nullable(),
      comments: z.number().int().nullable(),
      totalInteractions: z.number().int().nullable(),
    }),
  ),
});
export type SocialSnapshot = z.infer<typeof SocialSnapshotSchema>;

// ── Leasing ──────────────────────────────────────────────────────────────────

export const LeasingSnapshotSchema = z.object({
  applications: z.object({
    last30d: z.number().int(),
    deltaPctVsPrior30d: z.number().nullable(),
    approvalRatePct: z.number().nullable(),
    funnel: z.array(z.object({ status: z.string(), count: z.number().int() })),
    monthlySubmissions12m: z.array(z.object({ month: z.string(), applications: z.number().int() })),
  }),
  leases: z.object({
    active: z.number().int(),
    monthlyRentRoll: z.number(),
    avgRent: z.number().nullable(),
    holdover: z.number().int(),
    expiringNext90d: z.number().int(),
    upcomingExpirations: z.array(
      z.object({
        leaseId: z.number().int(),
        unitNumber: z.string().nullable(),
        leaseTo: DayString,
        rent: z.number().nullable(),
      }),
    ),
  }),
});
export type LeasingSnapshot = z.infer<typeof LeasingSnapshotSchema>;

export const LISTING_FILTERS = ["all", "section8", "market"] as const;
export const ListingFilterSchema = z.enum(LISTING_FILTERS);

export const RentalListingSchema = z.object({
  unitId: z.number().int(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  unitNumber: z.string().nullable(),
  bedrooms: z.string().nullable(),
  bathrooms: z.string().nullable(),
  rent: z.number().nullable(),
  deposit: z.number().nullable(),
  availableDate: DayString.nullable(),
  isSection8: z.boolean().nullable(),
  applicationUrl: z.string().nullable(),
});
export type RentalListing = z.infer<typeof RentalListingSchema>;

export const AvailableRentalsSchema = z.object({
  filter: ListingFilterSchema,
  count: z.number().int(),
  section8Count: z.number().int(),
  avgRent: z.number().nullable(),
  listings: z.array(RentalListingSchema),
});
export type AvailableRentals = z.infer<typeof AvailableRentalsSchema>;

// ── Utilities ────────────────────────────────────────────────────────────────

export const UTILITY_TARGET_STATUSES = [
  "unmatched",
  "no_active_lease",
  "resolved",
  "ambiguous",
] as const;
export const UtilityTargetStatusSchema = z.enum(UTILITY_TARGET_STATUSES);

/// A utility property resolved to the lease(s) that should carry its charge.
export const UtilityBillingTargetSchema = z.object({
  utilityPropertyId: Id,
  address: z.string(),
  billingMode: z.string(),
  propertyId: z.number().int().nullable(),
  buildiumAddress: z.string().nullable(),
  activeLeaseCount: z.number().int(),
  targetStatus: UtilityTargetStatusSchema,
  leases: z.array(
    z.object({
      leaseId: z.number().int(),
      unitNumber: z.string().nullable(),
      leaseTo: DayString.nullable(),
      rent: z.number().nullable(),
      chargeShare: z.number(),
    }),
  ),
});
export type UtilityBillingTarget = z.infer<typeof UtilityBillingTargetSchema>;

export const WaterBillChargeSchema = z.object({
  leaseId: z.number().int(),
  unitNumber: z.string().nullable(),
  chargeShare: z.number(),
  chargeAmount: z.number().nullable(),
  postStatus: z.enum(["pending", "posted", "skipped", "error"]),
  postedAmount: z.number().nullable(),
  postedMemo: z.string().nullable(),
  buildiumChargeId: z.number().int().nullable(),
  postedAt: IsoDate.nullable(),
  postError: z.string().nullable(),
});

export const WaterBillGroupSchema = z.object({
  waterBillId: Id,
  serviceAddress: z.string().nullable(),
  billingMonth: DayString.nullable(),
  memo: z.string().nullable(),
  dueDate: DayString.nullable(),
  billAmount: z.number().nullable(),
  parseStatus: z.string(),
  resolutionStatus: UtilityTargetStatusSchema,
  billingMode: z.string().nullable(),
  charges: z.array(WaterBillChargeSchema),
});
export type WaterBillGroup = z.infer<typeof WaterBillGroupSchema>;

export const UtilitiesOverviewSchema = z.object({
  targets: z.array(UtilityBillingTargetSchema),
  bills: z.array(WaterBillGroupSchema),
});
export type UtilitiesOverview = z.infer<typeof UtilitiesOverviewSchema>;

// ── Skills and context ───────────────────────────────────────────────────────

export const WorkspaceSkillRowSchema = z.object({
  id: Id,
  name: z.string(),
  kind: z.string(),
  version: z.number().int(),
  notes: z.string().nullable(),
  createdBy: z.string(),
  createdAt: IsoDate,
});
export const WorkspaceSkillSchema = WorkspaceSkillRowSchema.extend({ content: z.string() });
export type WorkspaceSkill = z.infer<typeof WorkspaceSkillSchema>;

export const WorkspaceContextEntrySchema = z.object({
  key: z.string(),
  content: z.string(),
  updatedBy: z.string(),
  updatedAt: IsoDate,
});
export type WorkspaceContextEntry = z.infer<typeof WorkspaceContextEntrySchema>;
