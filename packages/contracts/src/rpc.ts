import { eventIterator, oc } from "@orpc/contract";
import * as z from "zod";
import { AiConsentQuerySchema, AiConsentStatusSchema } from "./ai-consent.js";
import {
  ARTIFACT_DESCRIPTION_MAX_LENGTH,
  ARTIFACT_NAME_MAX_LENGTH,
  ATTACHMENT_MAX_BASE64_LENGTH,
  ATTACHMENT_MAX_COUNT,
} from "./attachments.js";
import {
  BoardEventSchema,
  BoardSchema,
  CommentTicketInput,
  CreateTicketInput,
  GetTicketInput,
  ListTicketsInput,
  ListTicketsOutput,
  MoveTicketInput,
  RenameBoardInput,
  TicketCommentSchema,
  TicketSchema,
  UpdateTicketInput,
} from "./board.js";
import { BotSecretMetadata, BotSecretPutInput, StoredBotSecretName } from "./bot-secrets.js";
import {
  MaintenanceApprovalSchema,
  MaintenanceCreateSchema,
  MaintenanceJobSchema,
  MaintenanceOverviewSchema,
} from "./maintenance.js";
import { TeamMemberSchema } from "./team.js";
import {
  ArchiveWaterBillsSchema,
  AvailableRentalsSchema,
  ChargePostBatchSchema,
  ChargePostResultSchema,
  DayString,
  EmailCampaignDetailSchema,
  EmailPerformanceSchema,
  EmailWindowSchema,
  LeasingSnapshotSchema,
  ListingFilterSchema,
  RecordCityUtilityBillSchema,
  ReportGenerateInputSchema,
  ReportSendResultSchema,
  ReportUpdateInputSchema,
  SaveUtilityPropertySchema,
  SocialSnapshotSchema,
  SyncCityBillsFromCrmResultSchema,
  UtilitiesOverviewSchema,
  VoiceAgentTypeSchema,
  VoiceCallDetailSchema,
  VoiceCallRowSchema,
  VoiceStatsSchema,
  WorkspaceAccessSchema,
  WorkspaceActivitySchema,
  WorkspaceAutomationKeySchema,
  WorkspaceAutomationSchema,
  WorkspaceContextEntrySchema,
  WorkspaceCredentialProviderSchema,
  WorkspaceCredentialRowSchema,
  WorkspaceOverviewSchema,
  WorkspacePipeSchema,
  WorkspaceReportRowSchema,
  WorkspaceReportSchema,
  WorkspaceSettingsSchema,
  WorkspaceSettingsUpdateSchema,
  WorkspaceSkillRowSchema,
  WorkspaceSkillSchema,
  WorkspaceSummarySchema,
} from "./workspace.js";
import { WorkspaceFileRequestSchema, WorkspaceFileResultSchema } from "./workspace-files.js";

export const WorkspaceChangeStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
  "conflict",
]);
export type WorkspaceChangeStatus = z.infer<typeof WorkspaceChangeStatusSchema>;

import {
  CRM_MODULE_FIELD_LABEL_MAX,
  CRM_MODULE_FIELD_MAX,
  CRM_MODULE_NAME_MAX,
  CRM_MODULE_SELECT_OPTION_MAX,
  CRM_MODULE_SELECT_OPTIONS_MAX,
  CrmModuleFieldInput,
  CrmModuleRecordSchema,
  CrmModuleSchema,
  CrmRecordValueSchema,
} from "./crm-modules.js";
import {
  ActionApprovalRuleSchema,
  ActionAutoReviewSettingsSchema,
  AgentSecretInputSchema,
  AgentSecretSchema,
  AgentSkillCatalogEntrySchema,
  AgentSkillSchema,
  AppBootstrapSchema,
  ArtifactSchema,
  ArtifactVersionSchema,
  ArtifactWithContentSchema,
  AvatarStyleSchema,
  BillingStatusSchema,
  BotCredentialSchema,
  BotMcpServerSchema,
  BotRunHistorySchema,
  BotSchema,
  BotSectionSchema,
  CapabilityInstallSchema,
  ComputerModeSchema,
  ComputerReleaseReasonSchema,
  ComputerStatusSchema,
  ComputerUpdateSchema,
  ConnectionCatalogItemSchema,
  ConnectionSchema,
  CreateAgentSkillInput,
  CreateBotCredentialInput,
  CreateBotInput,
  CreateGroupInput,
  CreateRoutineInput,
  CreateScratchpadItemInput,
  CrmContactSchema,
  CrmDealSchema,
  CrmOverviewSchema,
  CrmPipelineSchema,
  CrmTagSchema,
  DeploymentSettingsSchema,
  ExportManifestSchema,
  ExternalConversationPolicySchema,
  GroupDetailSchema,
  GroupSchema,
  IntegrationCatalogResultSchema,
  LocalComputerLiveSessionSchema,
  LocalDeviceSchema,
  McpServerConfigInput,
  McpServerSchema,
  MemoryDocumentSchema,
  MemoryScopeSchema,
  MeSchema,
  MessagingAgentConnectionSchema,
  MessagingChannelMembershipSchema,
  MessagingLinkedIdentitySchema,
  MessagingStatusSchema,
  ModelBackupChoiceSchema,
  ModelBackupListSchema,
  ModelCatalogEntrySchema,
  ModelConnectInputSchema,
  ModelCredentialSchema,
  ModelOAuthBeginSchema,
  PublicFormInputSchema,
  PublicFormSchema,
  REPLY_QUOTE_MAX_LENGTH,
  ReorderBotsInput,
  RoutineSchema,
  RunDiagnosticsSchema,
  ScratchpadItemSchema,
  ScratchpadItemStatusSchema,
  ServerUpdateCheckSchema,
  ServerUpdateRequestSchema,
  ServerUpdateRunSchema,
  ServerUpdateStatusSchema,
  SkillPlaybookSchema,
  SpaceMemoryConfigSchema,
  SpaceNavigationSchema,
  SpaceSchema,
  TaughtSkillSchema,
  TeachRecordingEventSchema,
  ThinkingLevelSchema,
  ThreadMessagePageSchema,
  ThreadSnapshotSchema,
  UpdateAgentSkillInput,
  UpdateBotCredentialInput,
  UpdateBotInput,
  UpdateExternalConversationPolicyInput,
  UpdateGroupInput,
  UsageRecordSchema,
  VerificationSummarySchema,
  VoiceCatalogEntrySchema,
  VoiceCredentialSchema,
  VoiceInfoSchema,
  VoiceStatusSchema,
} from "./domain.js";
import { ComputerCommandSchema, ProductEventSchema } from "./events.js";
import { Id, IsoDate } from "./ids.js";
import {
  IntegrationProviderConfigSchema,
  IntegrationSetupStateSchema,
} from "./integration-settings.js";
import { MessageReactionSchema } from "./reactions.js";
import { RoutineHistorySchema, RoutineRunCursorSchema, RunsListOutputSchema } from "./runs.js";
import { SearchQueryOutputSchema } from "./search.js";

const botId = z.object({ botId: Id });
const verificationRange = z.object({
  days: z.number().int().min(1).max(90),
  botId: Id.optional(),
});
const groupId = z.object({ groupId: Id });

const threadTarget = z
  .object({
    botId: Id.optional(),
    groupId: Id.optional(),
  })
  .superRefine((input, ctx) => {
    const hasBot = Boolean(input.botId);
    const hasGroup = Boolean(input.groupId);
    if (hasBot === hasGroup) {
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of botId or groupId",
        path: ["botId"],
      });
    }
  });

const structuredMentionTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bot"), id: Id }),
  z.object({ kind: z.literal("group"), id: Id }),
  z.object({ kind: z.literal("routine"), id: Id }),
  z.object({ kind: z.literal("connector"), id: Id }),
]);

/**
 * Pins which tools a run may use instead of leaving the choice to the model:
 * "vm" offers only computer/sandbox tools, "plugins" offers only connected
 * plugin tools, "auto" (the default) offers both.
 */
export const TOOL_ROUTING_MODES = ["auto", "vm", "plugins"] as const;
export type ToolRoutingMode = (typeof TOOL_ROUTING_MODES)[number];
const toolRoutingMode = z.enum(TOOL_ROUTING_MODES);

const threadSendInput = threadTarget
  .safeExtend({
    text: z.string().optional(),
    artifactIds: z.array(Id).max(ATTACHMENT_MAX_COUNT).optional(),
    /** Bare bot ids (legacy) or typed mention chips from the composer. */
    mentions: z
      .array(z.union([Id, structuredMentionTarget]))
      .max(64)
      .optional(),
    replyToMessageId: Id.optional(),
    replyQuote: z.string().trim().min(1).max(REPLY_QUOTE_MAX_LENGTH).optional(),
    clientNonce: z.string().min(1).max(200).optional(),
    toolRoutingMode: toolRoutingMode.optional(),
  })
  .superRefine((input, ctx) => {
    const text = input.text?.trim() ?? "";
    const artifactIds = input.artifactIds ?? [];
    if (!text && artifactIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Provide text or at least one attachment",
        path: ["text"],
      });
    }
    if (input.replyQuote && !input.replyToMessageId) {
      ctx.addIssue({
        code: "custom",
        message: "replyQuote requires replyToMessageId",
        path: ["replyQuote"],
      });
    }
  });

const spaceName = z.string().trim().min(1).max(60);

export const appContract = {
  team: {
    list: oc.output(z.array(TeamMemberSchema)),
    heartbeat: oc.output(z.object({ ok: z.literal(true) })),
  },
  maintenance: {
    list: oc.output(MaintenanceOverviewSchema),
    create: oc.input(MaintenanceCreateSchema).output(MaintenanceJobSchema),
    approve: oc.input(MaintenanceApprovalSchema).output(MaintenanceJobSchema),
    cancel: oc.input(z.object({ id: z.string().min(1) })).output(MaintenanceJobSchema),
  },
  aiConsent: {
    status: oc.input(AiConsentQuerySchema).output(AiConsentStatusSchema),
    allow: oc
      .input(
        z.object({
          scope: z.string(),
          version: z.string(),
          keys: z.array(z.string()).min(1).max(200),
        }),
      )
      .output(AiConsentStatusSchema),
    revoke: oc.input(z.object({ key: z.string().nullable() })).output(AiConsentStatusSchema),
  },
  health: oc.output(z.object({ ok: z.literal(true), version: z.string() })),
  me: oc.output(MeSchema),
  billing: {
    status: oc.output(BillingStatusSchema),
    checkout: oc.output(z.object({ url: z.string().url() })),
    portal: oc.output(z.object({ url: z.string().url() })),
  },
  preferences: {
    update: oc.input(z.object({ avatarStyle: AvatarStyleSchema })).output(MeSchema),
  },
  spaces: {
    list: oc.output(SpaceNavigationSchema),
    create: oc
      .input(z.object({ name: spaceName, shared: z.boolean().optional() }))
      .output(SpaceSchema),
    rename: oc
      .input(z.object({ spaceId: Id, name: spaceName }))
      .output(z.object({ id: Id, name: z.string() })),
    remove: oc
      .input(z.object({ spaceId: Id }))
      .output(z.object({ ok: z.literal(true), activeSpaceId: Id })),
  },
  bootstrap: oc.input(z.object({ botId: Id.optional() })).output(AppBootstrapSchema),
  deployment: {
    get: oc.output(DeploymentSettingsSchema),
    update: oc
      .input(
        z.object({
          signupsEnabled: z.boolean().optional(),
          signupAllowlist: z.array(z.string()).optional(),
          computerHost: z.enum(["docker", "this-mac"]).nullable().optional(),
        }),
      )
      .output(DeploymentSettingsSchema),
  },
  /**
   * Deployment-owner product updates. When the Compose updater sidecar is reachable, these proxy
   * to its `/state` `/plan` `/apply` contract. Rollback stays on the sidecar for ops only and is
   * not exposed here. Never git-fetch from the API process.
   */
  updater: {
    status: oc.output(ServerUpdateStatusSchema),
    check: oc.input(ServerUpdateRequestSchema).output(ServerUpdateCheckSchema),
    apply: oc.input(ServerUpdateRequestSchema).output(ServerUpdateRunSchema),
  },
  models: {
    list: oc.output(z.array(ModelCatalogEntrySchema)),
    credentials: oc.output(z.array(ModelCredentialSchema)),
    backups: oc.output(z.array(ModelBackupChoiceSchema)),
    setBackups: oc.input(ModelBackupListSchema).output(z.object({ ok: z.literal(true) })),
    connect: oc.input(ModelConnectInputSchema).output(ModelCredentialSchema),
    probeOpenAiCompatible: oc
      .input(
        z.object({
          baseUrl: z.string(),
          apiKey: z.string().optional(),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    probeCatalog: oc
      .input(
        z.object({
          provider: z.string().trim().min(1),
          apiKey: z.string().trim().min(8),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    beginOAuth: oc
      .input(
        z.object({
          provider: z.string(),
          label: z.string().optional(),
          modelId: z.string().optional(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
        }),
      )
      .output(ModelOAuthBeginSchema),
    submitOAuthCode: oc
      .input(z.object({ loginId: z.string(), code: z.string().trim().min(1).max(8_192) }))
      .output(z.object({ ok: z.literal(true) })),
    completeOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(
        z.discriminatedUnion("status", [
          z.object({ status: z.literal("pending") }),
          z.object({ status: z.literal("ready") }),
          z.object({ status: z.literal("error"), error: z.string() }),
        ]),
      ),
    finishOAuth: oc.input(z.object({ loginId: z.string() })).output(ModelCredentialSchema),
    cancelOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    setDefault: oc
      .input(
        z.object({
          provider: z.string(),
          modelId: z.string(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    disconnect: oc
      .input(z.object({ provider: z.string().trim().min(1) }))
      .output(z.object({ ok: z.literal(true) })),
  },
  bots: {
    list: oc.output(z.array(BotSchema)),
    listArchived: oc.output(z.array(BotSchema)),
    get: oc.input(botId).output(BotSchema),
    create: oc.input(CreateBotInput).output(BotSchema),
    duplicate: oc.input(botId).output(BotSchema),
    reorder: oc.input(ReorderBotsInput).output(z.object({ ok: z.literal(true) })),
    update: oc.input(UpdateBotInput).output(BotSchema),
    setComputer: oc.input(z.object({ botId: Id, mode: ComputerModeSchema })).output(BotSchema),
    archive: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    restore: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    remove: oc
      .input(z.object({ botId: Id, deleteMemories: z.boolean().default(false) }))
      .output(z.object({ ok: z.literal(true) })),
    rotateWebhookSecret: oc.input(botId).output(
      z.object({
        secret: z.string(),
        path: z.string(),
        webhookConfigured: z.literal(true),
      }),
    ),
  },
  groups: {
    create: oc.input(CreateGroupInput).output(GroupSchema),
    list: oc.output(z.array(GroupSchema)),
    listArchived: oc.output(z.array(GroupSchema)),
    get: oc.input(groupId).output(GroupDetailSchema),
    duplicate: oc.input(groupId).output(GroupSchema),
    update: oc.input(UpdateGroupInput).output(GroupSchema),
    archive: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    restore: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    remove: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
  },
  botSections: {
    list: oc.output(z.array(BotSectionSchema)),
    create: oc
      .input(threadTarget.safeExtend({ name: z.string().trim().min(1).max(60) }))
      .output(BotSectionSchema),
    update: oc
      .input(z.object({ sectionId: Id, name: z.string().trim().min(1).max(60) }))
      .output(BotSectionSchema),
  },
  /// The client's operations warehouse. `status` is cheap and drives the nav;
  /// `overview` is the one round trip the pipeline map needs.
  workspace: {
    team: {
      list: oc.output(z.array(BotSchema)),
      open: oc.input(z.object({ botId: Id.optional() })).output(BotSchema),
    },
    status: oc.output(z.object({ workspace: WorkspaceSummarySchema.nullable() })),
    access: oc.output(WorkspaceAccessSchema),
    overview: oc.output(WorkspaceOverviewSchema),
    system: oc.output(z.object({ pipes: z.array(WorkspacePipeSchema) })),
    voice: {
      stats: oc
        .input(
          z.object({
            days: z.number().int().min(1).max(365).default(30),
            agentType: VoiceAgentTypeSchema.optional(),
          }),
        )
        .output(VoiceStatsSchema),
      calls: oc
        .input(
          z.object({
            days: z.number().int().min(1).max(365).default(30),
            agentType: VoiceAgentTypeSchema.optional(),
            search: z.string().trim().max(120).optional(),
            callbackOnly: z.boolean().default(false),
            limit: z.number().int().min(1).max(200).default(50),
          }),
        )
        .output(z.object({ calls: z.array(VoiceCallRowSchema) })),
      call: oc.input(z.object({ callId: Id })).output(VoiceCallDetailSchema),
    },
    reports: {
      list: oc.output(z.array(WorkspaceReportRowSchema)),
      generate: oc.input(ReportGenerateInputSchema).output(WorkspaceReportSchema),
      testEmail: oc
        .input(z.object({ reportId: Id, to: z.string().trim().email().max(320) }))
        .output(z.object({ ok: z.literal(true) })),
      get: oc.input(z.object({ reportId: Id })).output(WorkspaceReportSchema),
      /// Rewrite the human-editable prose; refused once the report is approved.
      update: oc.input(ReportUpdateInputSchema).output(WorkspaceReportSchema),
      approve: oc.input(z.object({ reportId: Id })).output(WorkspaceReportSchema),
      /// Approve (if not yet) and email the rendered report to each address.
      send: oc
        .input(
          z.object({
            reportId: Id,
            to: z.array(z.string().trim().email().max(320)).min(1).max(20),
          }),
        )
        .output(ReportSendResultSchema),
      /// Drafts only: a report that was approved or sent stays.
      remove: oc.input(z.object({ reportId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    /// Scheduled pipelines. `list` seeds the defaults for the workspace's
    /// channels; `run` enqueues one now and returns its sync-run id.
    automations: {
      list: oc.output(z.array(WorkspaceAutomationSchema)),
      run: oc
        .input(z.object({ key: WorkspaceAutomationKeySchema }))
        .output(z.object({ runId: Id })),
      update: oc
        .input(
          z.object({
            key: WorkspaceAutomationKeySchema,
            enabled: z.boolean().optional(),
            crons: z.array(z.string().trim().min(1).max(80)).min(1).max(8).optional(),
          }),
        )
        .output(WorkspaceAutomationSchema),
    },
    settings: {
      get: oc.output(WorkspaceSettingsSchema),
      update: oc.input(WorkspaceSettingsUpdateSchema).output(WorkspaceSettingsSchema),
    },
    /// Stored provider logins. Values never leave the server; `set` merges and
    /// an empty string clears a field. Owners and admins only for set/remove.
    credentials: {
      list: oc.output(z.array(WorkspaceCredentialRowSchema)),
      set: oc
        .input(
          z.object({
            provider: WorkspaceCredentialProviderSchema,
            label: z.string().trim().max(120).optional(),
            fields: z.record(
              z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
              z.string().max(4096),
            ),
          }),
        )
        .output(WorkspaceCredentialRowSchema),
      remove: oc
        .input(z.object({ provider: WorkspaceCredentialProviderSchema }))
        .output(z.object({ ok: z.literal(true) })),
    },
    email: {
      performance: oc
        .input(z.object({ window: EmailWindowSchema.default("12m") }))
        .output(EmailPerformanceSchema),
      campaign: oc
        .input(z.object({ sourceCampaignId: z.string().min(1) }))
        .output(EmailCampaignDetailSchema),
    },
    social: {
      snapshot: oc
        .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
        .output(SocialSnapshotSchema),
    },
    leasing: {
      snapshot: oc.output(LeasingSnapshotSchema),
      rentals: oc
        .input(z.object({ filter: ListingFilterSchema.default("all") }))
        .output(AvailableRentalsSchema),
    },
    utilities: {
      overview: oc.output(UtilitiesOverviewSchema),
      /// Record the city's current charges for one property and month. Does not post to Buildium.
      recordCityBill: oc.input(RecordCityUtilityBillSchema).output(UtilitiesOverviewSchema),
      property: {
        /// Add a tracked property or edit its address, spellings, Buildium link and billing.
        save: oc.input(SaveUtilityPropertySchema).output(UtilitiesOverviewSchema),
        /// Stop or resume tracking a property; its bills leave or return to the billing view.
        archive: oc
          .input(z.object({ utilityPropertyId: Id, archived: z.boolean() }))
          .output(UtilitiesOverviewSchema),
      },
      /// Archive or restore a billing month. Posted charges are unaffected.
      archiveBills: oc.input(ArchiveWaterBillsSchema).output(UtilitiesOverviewSchema),
      /// Copy city current charges from CRM onto Gmail notices with the same due date.
      syncFromCrm: oc.input(z.object({})).output(SyncCityBillsFromCrmResultSchema),
      charge: {
        /// Edit the amount or memo before posting; a skipped charge comes back to pending.
        save: oc
          .input(
            z.object({
              waterBillId: Id,
              leaseId: z.number().int(),
              amount: z.number().nonnegative().optional(),
              memo: z.string().trim().max(200).optional(),
            }),
          )
          .output(UtilitiesOverviewSchema),
        skip: oc
          .input(z.object({ waterBillId: Id, leaseId: z.number().int() }))
          .output(UtilitiesOverviewSchema),
        /// Post one lease's share to the property ledger; dryRun returns the request only.
        post: oc
          .input(
            z.object({
              waterBillId: Id,
              leaseId: z.number().int(),
              amount: z.number().nonnegative().optional(),
              memo: z.string().trim().max(200).optional(),
              chargeDate: DayString.optional(),
              dryRun: z.boolean().default(false),
            }),
          )
          .output(ChargePostResultSchema),
      },
      /// Every resolved, pending charge, oldest due date first; one failure does not stop the rest.
      postAllPending: oc
        .input(z.object({ dryRun: z.boolean().default(false) }))
        .output(ChargePostBatchSchema),
    },
    activities: {
      list: oc
        .input(
          z.object({
            channel: z.string().trim().max(40).optional(),
            limit: z.number().int().min(1).max(200).default(50),
          }),
        )
        .output(z.array(WorkspaceActivitySchema)),
    },
    skills: {
      list: oc.output(z.array(WorkspaceSkillRowSchema)),
      get: oc
        .input(z.object({ name: z.string().min(1), version: z.number().int().optional() }))
        .output(WorkspaceSkillSchema),
    },
    context: {
      list: oc.output(z.array(WorkspaceContextEntrySchema)),
    },
  },
  crm: {
    overview: oc.output(CrmOverviewSchema),
    contacts: {
      create: oc
        .input(
          z.object({
            firstName: z.string().trim().min(1).max(120),
            lastName: z.string().trim().max(120).default(""),
            email: z.string().trim().max(320).optional(),
            phone: z.string().trim().max(40).optional(),
            company: z.string().trim().max(200).optional(),
            notes: z.string().max(4000).optional(),
            tagIds: z.array(Id).max(20).optional(),
          }),
        )
        .output(CrmContactSchema),
      update: oc
        .input(
          z.object({
            contactId: Id,
            firstName: z.string().trim().min(1).max(120).optional(),
            lastName: z.string().trim().max(120).optional(),
            email: z.string().trim().max(320).nullable().optional(),
            phone: z.string().trim().max(40).nullable().optional(),
            company: z.string().trim().max(200).nullable().optional(),
            notes: z.string().max(4000).nullable().optional(),
            status: z.enum(["active", "archived"]).optional(),
            tagIds: z.array(Id).max(20).optional(),
          }),
        )
        .output(CrmContactSchema),
      delete: oc.input(z.object({ contactId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    tags: {
      create: oc
        .input(
          z.object({
            name: z.string().trim().min(1).max(60),
            color: z.string().max(16).optional(),
          }),
        )
        .output(CrmTagSchema),
    },
    pipelines: {
      create: oc
        .input(
          z.object({
            name: z.string().trim().min(1).max(120),
            stages: z
              .array(z.object({ name: z.string().trim().min(1).max(60) }))
              .min(1)
              .max(12),
          }),
        )
        .output(CrmPipelineSchema),
      /// First visit gets a ready board instead of an empty screen.
      seed: oc.output(CrmOverviewSchema),
      delete: oc.input(z.object({ pipelineId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    deals: {
      create: oc
        .input(
          z.object({
            pipelineId: Id,
            stageId: Id,
            title: z.string().trim().min(1).max(200),
            value: z.number().int().min(0).max(1_000_000_000).default(0),
            contactId: Id.optional(),
          }),
        )
        .output(CrmDealSchema),
      update: oc
        .input(
          z.object({
            dealId: Id,
            title: z.string().trim().min(1).max(200).optional(),
            value: z.number().int().min(0).max(1_000_000_000).optional(),
            contactId: Id.nullable().optional(),
            status: z.enum(["open", "won", "lost"]).optional(),
          }),
        )
        .output(CrmDealSchema),
      move: oc.input(z.object({ dealId: Id, stageId: Id })).output(CrmDealSchema),
      delete: oc.input(z.object({ dealId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    modules: {
      list: oc.output(z.array(CrmModuleSchema)),
      create: oc
        .input(
          z.object({
            name: z.string().trim().min(1).max(CRM_MODULE_NAME_MAX),
            fields: z.array(CrmModuleFieldInput).max(CRM_MODULE_FIELD_MAX).default([]),
          }),
        )
        .output(CrmModuleSchema),
      update: oc
        .input(
          z.object({
            moduleId: Id,
            name: z.string().trim().min(1).max(CRM_MODULE_NAME_MAX).optional(),
          }),
        )
        .output(CrmModuleSchema),
      delete: oc.input(z.object({ moduleId: Id })).output(z.object({ ok: z.literal(true) })),
      fields: {
        create: oc
          .input(z.object({ moduleId: Id }).safeExtend(CrmModuleFieldInput.shape))
          .output(CrmModuleSchema),
        update: oc
          .input(
            z.object({
              moduleId: Id,
              fieldId: Id,
              label: z.string().trim().min(1).max(CRM_MODULE_FIELD_LABEL_MAX).optional(),
              options: z
                .array(z.string().trim().min(1).max(CRM_MODULE_SELECT_OPTION_MAX))
                .max(CRM_MODULE_SELECT_OPTIONS_MAX)
                .optional(),
            }),
          )
          .output(CrmModuleSchema),
        delete: oc.input(z.object({ moduleId: Id, fieldId: Id })).output(CrmModuleSchema),
      },
      records: {
        list: oc
          .input(
            z.object({
              moduleId: Id,
              cursor: z.string().optional(),
              limit: z.number().int().min(1).max(200).default(100),
            }),
          )
          .output(
            z.object({
              data: z.array(CrmModuleRecordSchema),
              nextCursor: z.string().nullable(),
            }),
          ),
        create: oc
          .input(
            z.object({
              moduleId: Id,
              values: z.record(z.string(), CrmRecordValueSchema).default({}),
            }),
          )
          .output(CrmModuleRecordSchema),
        update: oc
          .input(
            z.object({
              recordId: Id,
              values: z.record(z.string(), CrmRecordValueSchema),
            }),
          )
          .output(CrmModuleRecordSchema),
        delete: oc.input(z.object({ recordId: Id })).output(z.object({ ok: z.literal(true) })),
      },
    },
  },
  threads: {
    head: oc.input(threadTarget).output(
      z.object({
        threadId: Id,
        cursor: z.number().int().min(-1),
      }),
    ),
    get: oc.input(threadTarget).output(ThreadSnapshotSchema),
    messages: oc
      .input(
        threadTarget.safeExtend({
          before: z.number().int().nonnegative().optional(),
          includePeerRuns: z.boolean().optional(),
          includePeerReceipts: z.boolean().optional(),
          around: z
            .object({
              messageId: Id.optional(),
              seq: z.number().int().nonnegative().optional(),
            })
            .optional(),
        }),
      )
      .output(ThreadMessagePageSchema),
    subscribe: oc
      .input(threadTarget.safeExtend({ cursor: z.number().int().min(-1) }))
      .output(eventIterator(ProductEventSchema)),
    send: oc.input(threadSendInput).output(
      z.object({
        taskId: Id,
        runId: Id,
        seq: z.number().int(),
        runIds: z.array(Id).optional(),
      }),
    ),
    react: oc
      .input(
        threadTarget.safeExtend({
          messageId: Id,
          reaction: MessageReactionSchema,
          clientNonce: z.string().min(1).max(200),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    stop: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    followUp: oc
      .input(
        threadTarget.safeExtend({
          text: z.string().min(1),
          /** Carries the call id, so a turn taken mid-run stays in the call's card. */
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    /** The client hung up: close the call card and let the bot finish what was asked on it. */
    endCall: oc
      // ":" separates the call id from the nonce suffix, so it can never appear inside one.
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    clear: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    answer: oc
      .input(
        threadTarget.safeExtend({
          runId: Id,
          messageId: Id,
          answer: z.string().min(1),
          /** Only for a login card; `answer` carries its password. */
          username: z.string().min(1).max(512).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    markRead: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    markUnread: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
  },
  computer: {
    workspace: oc.input(WorkspaceFileRequestSchema).output(WorkspaceFileResultSchema),
    status: oc.input(botId).output(ComputerStatusSchema),
    boot: oc.input(botId).output(ComputerStatusSchema),
    stop: oc.input(botId).output(ComputerStatusSchema),
    recover: oc.input(botId).output(ComputerUpdateSchema),
    reset: oc.input(botId).output(ComputerStatusSchema),
    update: oc.input(botId).output(ComputerUpdateSchema),
    updates: oc.output(z.array(ComputerUpdateSchema)),
    releaseInterrupted: oc
      .input(z.object({ id: Id, workersStopped: z.literal(true) }))
      .output(z.object({ ok: z.literal(true) })),
    dismissUpdate: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    takeover: oc.input(botId).output(z.object({ leaseId: Id, expiresAt: z.string() })),
    release: oc
      .input(
        z.object({
          botId: Id,
          reason: ComputerReleaseReasonSchema.optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    input: oc
      .input(
        z.object({
          botId: Id,
          kind: z.enum(["key", "pointer", "clipboard", "scroll"]),
          payload: z.record(z.string(), z.unknown()),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    files: oc
      .input(z.object({ botId: Id, path: z.string().default("/") }))
      .output(
        z.array(z.object({ path: z.string(), kind: z.enum(["file", "dir"]), size: z.number() })),
      ),
    readFile: oc
      .input(z.object({ botId: Id, path: z.string() }))
      .output(z.object({ path: z.string(), content: z.string() })),
    writeFile: oc
      .input(z.object({ botId: Id, path: z.string().min(1), content: z.string().max(2_000_000) }))
      .output(z.object({ path: z.string() })),
    /** Uncommitted work in every git repository inside the bot's workspace. */
    changes: oc.input(botId).output(
      z.object({
        available: z.boolean(),
        repos: z.array(
          z.object({
            path: z.string(),
            files: z.array(z.object({ path: z.string(), status: WorkspaceChangeStatusSchema })),
          }),
        ),
      }),
    ),
    diff: oc
      .input(z.object({ botId: Id, repo: z.string(), path: z.string().min(1) }))
      .output(z.object({ diff: z.string(), truncated: z.boolean() })),
    upload: oc
      .input(
        z.object({
          botId: Id,
          filename: z.string().min(1).max(200),
          dataBase64: z.string().max(14_000_000),
        }),
      )
      .output(z.object({ path: z.string() })),
    downloadFile: oc
      .input(z.object({ botId: Id, path: z.string().min(1) }))
      .output(z.object({ path: z.string(), contentBase64: z.string() })),
    uploadFile: oc
      .input(
        z.object({
          botId: Id,
          path: z.string().min(1),
          contentBase64: z.string().max(ATTACHMENT_MAX_BASE64_LENGTH),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    terminalUrl: oc.input(botId).output(z.object({ url: z.string().nullable() })),
    commands: oc
      .input(botId)
      .output(z.array(ComputerCommandSchema.extend({ createdAt: z.string() }))),
    screenUrl: oc.input(botId).output(z.object({ url: z.string().nullable() })),
    previewUrl: oc
      .input(
        z.object({
          botId: Id,
          port: z.number().int().min(1024).max(65_535),
          path: z.string().max(2000).optional(),
        }),
      )
      .output(z.object({ url: z.string().nullable() })),
    heartbeat: oc.input(botId).output(z.object({ ok: z.literal(true) })),
  },
  memory: {
    list: oc
      .input(z.object({ botId: Id.optional(), scope: z.enum(["bot", "user"]).optional() }))
      .output(z.array(MemoryDocumentSchema)),
    update: oc
      .input(z.object({ documentId: Id, content: z.string() }))
      .output(MemoryDocumentSchema),
    exportMarkdown: oc.input(z.object({ botId: Id.optional() })).output(z.string()),
    providerConfig: oc.output(SpaceMemoryConfigSchema.nullable()),
    connectProvider: oc
      .input(
        z.object({
          provider: z.string().min(1),
          settings: z.record(z.string(), z.string()),
          credentials: z.record(z.string(), z.string()),
          defaultMemoryScope: MemoryScopeSchema.default("isolated"),
        }),
      )
      .output(SpaceMemoryConfigSchema),
    setDefaultScope: oc
      .input(z.object({ defaultMemoryScope: MemoryScopeSchema }))
      .output(SpaceMemoryConfigSchema),
    disconnectProvider: oc.output(z.object({ ok: z.literal(true) })),
  },
  credentials: {
    list: oc.input(botId).output(z.array(BotCredentialSchema)),
    create: oc.input(CreateBotCredentialInput).output(BotCredentialSchema),
    update: oc.input(UpdateBotCredentialInput).output(BotCredentialSchema),
    remove: oc.input(z.object({ credentialId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  routines: {
    list: oc.input(botId).output(z.array(RoutineSchema)),
    history: oc
      .input(z.object({ routineId: Id, before: RoutineRunCursorSchema.optional() }))
      .output(RoutineHistorySchema),
    create: oc.input(CreateRoutineInput).output(RoutineSchema),
    update: oc
      .input(
        z
          .object({
            routineId: Id,
            name: z.string().optional(),
            prompt: z.string().optional(),
            crons: z.array(z.string().min(1)).optional(),
            timezone: z.string().optional(),
            active: z.boolean().optional(),
            notify: z.boolean().optional(),
            webhookEnabled: z.boolean().optional(),
            githubEnabled: z.boolean().optional(),
            messageProvider: z
              .string()
              .min(1)
              .max(50)
              .regex(/^[a-z0-9._-]+$/i)
              .nullable()
              .optional(),
            /** Null clears the routine's own model and runs it on the bot's. */
            modelProvider: z.string().trim().min(1).max(80).nullable().optional(),
            modelId: z.string().trim().min(1).max(200).nullable().optional(),
            thinkingLevel: ThinkingLevelSchema.nullable().optional(),
            /** ISO datetime to arm a never-run one-shot. */
            runAt: IsoDate.optional(),
          })
          .superRefine((value, ctx) => {
            if (
              value.crons &&
              value.crons.length === 0 &&
              value.webhookEnabled === false &&
              value.githubEnabled === false &&
              value.messageProvider === null
            ) {
              ctx.addIssue({
                code: "custom",
                message: "Add a schedule, webhook, GitHub, or message trigger",
                path: ["crons"],
              });
            }
          }),
      )
      .output(RoutineSchema),
    remove: oc.input(z.object({ routineId: Id })).output(z.object({ ok: z.literal(true) })),
    testRun: oc
      .input(
        z.object({
          routineId: Id,
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(z.object({ runId: Id })),
  },
  scratchpad: {
    list: oc
      .input(
        z.object({
          botId: Id,
          status: ScratchpadItemStatusSchema.optional(),
          includeDone: z.boolean().optional(),
        }),
      )
      .output(z.array(ScratchpadItemSchema)),
    create: oc.input(CreateScratchpadItemInput).output(ScratchpadItemSchema),
    update: oc
      .input(
        z.object({
          itemId: Id,
          title: z.string().min(1).max(200).optional(),
          status: ScratchpadItemStatusSchema.optional(),
          notes: z.string().max(4_000).optional(),
        }),
      )
      .output(ScratchpadItemSchema),
    remove: oc.input(z.object({ itemId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  boards: {
    list: oc.output(z.array(BoardSchema)),
    get: oc.output(BoardSchema),
    rename: oc.input(RenameBoardInput).output(BoardSchema),
    subscribe: oc.output(eventIterator(BoardEventSchema)),
  },
  tickets: {
    list: oc.input(ListTicketsInput).output(ListTicketsOutput),
    get: oc.input(GetTicketInput).output(TicketSchema),
    create: oc.input(CreateTicketInput).output(TicketSchema),
    update: oc.input(UpdateTicketInput).output(TicketSchema),
    move: oc.input(MoveTicketInput).output(TicketSchema),
    comment: oc.input(CommentTicketInput).output(TicketCommentSchema),
    comments: oc.input(z.object({ ticketId: Id })).output(z.array(TicketCommentSchema)),
  },
  skills: {
    list: oc.input(botId).output(z.array(TaughtSkillSchema)),
    get: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    start: oc
      .input(z.object({ botId: Id, goal: z.string().min(1).max(4000) }))
      .output(TaughtSkillSchema),
    appendEvent: oc
      .input(z.object({ skillId: Id, event: TeachRecordingEventSchema }))
      .output(TaughtSkillSchema),
    snapshot: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    stop: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    updateDraft: oc
      .input(
        z.object({
          skillId: Id,
          name: z.string().optional(),
          playbook: SkillPlaybookSchema,
        }),
      )
      .output(TaughtSkillSchema),
    save: oc
      .input(z.object({ skillId: Id, name: z.string().optional() }))
      .output(TaughtSkillSchema),
    testRun: oc
      .input(z.object({ skillId: Id, prompt: z.string().optional() }))
      .output(z.object({ runId: Id })),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  /** Claude Agent Skills (SKILL.md recipes) shared across assistants (not taught/demo skills). Pi already understands this format; we persist and inject them. */
  agentSkills: {
    list: oc.output(z.array(AgentSkillCatalogEntrySchema)),
    get: oc
      .input(
        z
          .object({ skillId: Id.optional(), name: z.string().min(1).max(80).optional() })
          .superRefine((input, ctx) => {
            if (!input.skillId && !input.name?.trim()) {
              ctx.addIssue({
                code: "custom",
                message: "Provide skillId or name",
                path: ["skillId"],
              });
            }
          }),
      )
      .output(AgentSkillSchema),
    create: oc.input(CreateAgentSkillInput).output(AgentSkillSchema),
    update: oc.input(UpdateAgentSkillInput).output(AgentSkillSchema),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  capabilities: {
    list: oc.output(z.array(CapabilityInstallSchema)),
    catalogSearch: oc
      .input(
        z.object({
          query: z.string().trim().max(253).default(""),
          usePublicCatalog: z.boolean().default(false),
        }),
      )
      .output(
        z.object({
          enabled: z.boolean(),
          results: z.array(IntegrationCatalogResultSchema),
        }),
      ),
    install: oc
      .input(
        z.object({
          kind: z.enum(["skill", "plugin", "mcp", "api", "graphql"]),
          name: z.string().min(1).max(120),
          source: z.string().min(1).max(2048),
          config: z.record(z.string(), z.unknown()).default({}),
          credential: z.string().max(16_384).optional(),
        }),
      )
      .output(CapabilityInstallSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  mcp: {
    servers: {
      list: oc.output(z.array(McpServerSchema)),
      create: oc.input(McpServerConfigInput).output(McpServerSchema),
      update: oc
        .input(
          z.union([
            z.object({ id: Id, config: McpServerConfigInput }),
            z.object({ id: Id, secret: z.string().min(1).max(16384) }),
          ]),
        )
        .output(McpServerSchema),
      remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    },
    assignments: {
      list: oc.input(botId).output(z.array(BotMcpServerSchema)),
      all: oc.output(z.array(BotMcpServerSchema)),
      approve: oc
        .input(z.object({ botId: Id, serverId: Id, threadId: Id.optional() }))
        .output(BotMcpServerSchema),
      dismiss: oc
        .input(z.object({ botId: Id, serverId: Id, threadId: Id.optional() }))
        .output(z.object({ ok: z.literal(true) })),
      replace: oc
        .input(
          z.object({
            botId: Id,
            assignments: z.array(
              z.object({
                serverId: Id,
                allowAllTools: z.boolean().default(true),
                allowedTools: z.array(z.string().min(1).max(200)).max(500).default([]),
              }),
            ),
          }),
        )
        .output(z.array(BotMcpServerSchema)),
    },
    oauth: {
      begin: oc.input(z.object({ serverId: Id, redirectUri: z.string().url() })).output(
        z.discriminatedUnion("status", [
          z.object({
            status: z.literal("authorization_required"),
            sessionId: Id,
            authorizationUrl: z.string().url(),
            /** "paste": the provider only accepts a loopback callback the user pastes back. */
            completion: z.enum(["popup", "paste"]),
          }),
          z.object({
            status: z.enum(["already_connected", "authorization_not_requested"]),
          }),
        ]),
      ),
      complete: oc
        .input(z.object({ sessionId: Id, code: z.string().min(1), state: z.string().min(1) }))
        .output(z.object({ ok: z.literal(true) })),
      disconnect: oc.input(z.object({ serverId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  onboarding: {
    /** Seed the first-run greeting into the bot's thread (focus card is separate). */
    start: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Post the focus choice card when the thread is still idle. */
    promptFocus: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Answer the focus choice; posts the app cards. Does not rename the bot. */
    choose: oc
      .input(z.object({ botId: Id, optionId: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    /** Dismiss the unanswered focus card without choosing an option. */
    dismissFocus: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Flip an app_connect card to connected after authorization completes. */
    appConnected: oc
      .input(
        z.object({ botId: Id, provider: z.string(), connectorId: z.string().default("composio") }),
      )
      .output(z.object({ ok: z.literal(true) })),
  },
  integrationSetup: {
    get: oc.output(IntegrationSetupStateSchema),
    save: oc.input(IntegrationProviderConfigSchema).output(z.object({ ok: z.literal(true) })),
  },
  connections: {
    catalog: oc
      .input(z.object({ query: z.string().optional(), connectorId: z.string().optional() }))
      .output(z.array(ConnectionCatalogItemSchema)),
    list: oc.output(z.array(ConnectionSchema)),
    begin: oc
      .input(
        z.object({
          connectorId: z.string().default("composio"),
          provider: z.string(),
          displayName: z.string(),
        }),
      )
      .output(
        z.object({
          connectionId: Id,
          authorizationUrl: z.string().nullable(),
          accountLink: ConnectionCatalogItemSchema.shape.accountLink,
        }),
      ),
    complete: oc
      .input(z.object({ connectionId: Id, code: z.string().optional() }))
      .output(ConnectionSchema),
    rename: oc
      .input(z.object({ connectionId: Id, displayName: z.string().trim().min(1).max(80) }))
      .output(ConnectionSchema),
    revoke: oc.input(z.object({ connectionId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Tools the connected provider exposes. Read-only; no per-tool allowlist yet. */
    tools: oc.input(z.object({ connectorId: z.string(), provider: z.string() })).output(
      z.array(
        z.object({
          name: z.string(),
          description: z.string(),
        }),
      ),
    ),
  },
  /** External messaging surface: link state, group channels, agent connections. */
  messaging: {
    status: oc.output(MessagingStatusSchema),
    link: {
      /** Issue a short-lived code the user sends to the line from a chat app. */
      start: oc
        .input(z.object({ botId: Id }))
        .output(z.object({ code: z.string(), expiresAt: z.string() })),
    },
    identities: {
      setBot: oc
        .input(z.object({ identityId: Id, botId: Id }))
        .output(MessagingLinkedIdentitySchema),
      unlink: oc.input(z.object({ identityId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    channels: {
      list: oc.output(z.array(MessagingChannelMembershipSchema)),
      // Addressed by membership, not channel: one user can have two linked
      // chat apps in the same group, and each answers for its own agent.
      respond: oc
        .input(z.object({ membershipId: Id, accept: z.boolean() }))
        .output(MessagingChannelMembershipSchema),
      leave: oc.input(z.object({ membershipId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    connections: {
      list: oc.output(z.array(MessagingAgentConnectionSchema)),
      respond: oc
        .input(z.object({ connectionId: Id, accept: z.boolean() }))
        .output(MessagingAgentConnectionSchema),
      revoke: oc.input(z.object({ connectionId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  approvalRules: {
    list: oc.output(z.array(ActionApprovalRuleSchema)),
    set: oc
      .input(
        z.object({
          effect: z.enum(["always_allow", "require_approval"]),
          matchKind: z.enum(["tool", "connector", "category"]),
          matchValue: z.string().min(1),
        }),
      )
      .output(ActionApprovalRuleSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  autoReview: {
    get: oc.output(ActionAutoReviewSettingsSchema),
    set: oc
      .input(
        z.object({
          enabled: z.boolean().optional(),
          checkAnswers: z.boolean().optional(),
          engine: z.string().min(1).optional(),
          compare: z.boolean().optional(),
        }),
      )
      .output(ActionAutoReviewSettingsSchema),
  },
  publicForms: {
    /** Owners see and edit their organization's forms; everyone else gets canManage: false. */
    list: oc.output(z.object({ canManage: z.boolean(), forms: z.array(PublicFormSchema) })),
    save: oc.input(PublicFormInputSchema.extend({ id: Id.optional() })).output(PublicFormSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  verification: {
    summary: oc.input(verificationRange).output(VerificationSummarySchema),
    report: oc
      .input(verificationRange.extend({ format: z.enum(["markdown", "csv"]) }))
      .output(z.object({ filename: z.string(), mimeType: z.string(), content: z.string() })),
  },
  artifacts: {
    list: oc.input(botId).output(z.array(ArtifactSchema)),
    listSpace: oc
      .input(
        z.object({
          botId: Id.optional(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(60).optional(),
        }),
      )
      .output(
        z.object({
          items: z.array(ArtifactSchema.extend({ versionCount: z.number().int() })),
          nextCursor: z.string().nullable(),
        }),
      ),
    listVersions: oc.input(z.object({ familyId: Id })).output(z.array(ArtifactVersionSchema)),
    create: oc
      .input(
        threadTarget.and(
          z.object({
            name: z.string().min(1).max(ARTIFACT_NAME_MAX_LENGTH),
            description: z.string().max(ARTIFACT_DESCRIPTION_MAX_LENGTH).optional(),
            mimeType: z.string().min(1),
            contentBase64: z.string().min(1).max(ATTACHMENT_MAX_BASE64_LENGTH),
          }),
        ),
      )
      .output(ArtifactSchema),
    get: oc.input(threadTarget.and(z.object({ artifactId: Id }))).output(ArtifactWithContentSchema),
    getById: oc.input(z.object({ artifactId: Id })).output(ArtifactWithContentSchema),
    remove: oc.input(z.object({ artifactId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  usage: {
    list: oc.output(z.array(UsageRecordSchema)),
    summary: oc.output(
      z.object({
        inputTokens: z.number().nullable(),
        outputTokens: z.number().nullable(),
        totalTokens: z.number().nullable().optional(),
        modelCalls: z.number().optional(),
        runs: z.number(),
      }),
    ),
  },
  export: {
    bot: oc.input(botId).output(ExportManifestSchema),
  },
  notifications: {
    registerPush: oc
      // No whitespace: the token store keeps the registering session on the next line.
      .input(z.object({ token: z.string().min(8).max(512).regex(/^\S+$/) }))
      .output(z.object({ ok: z.literal(true) })),
    unregisterPush: oc.output(z.object({ ok: z.literal(true) })),
  },
  search: {
    query: oc.input(z.object({ q: z.string().max(200) })).output(SearchQueryOutputSchema),
  },
  /**
   * Attended laptop sessions. The desktop app starts sharing; chat only selects
   * the live computer. Does not change SANDBOX_PROVIDER or computerHost.
   */
  localComputer: {
    session: oc.output(LocalComputerLiveSessionSchema),
    devices: oc.output(z.array(LocalDeviceSchema)),
    register: oc.input(z.object({ name: z.string().trim().min(1).max(80).optional() })).output(
      z.object({
        deviceId: Id,
        token: z.string(),
        tokenPrefix: z.string(),
      }),
    ),
    revoke: oc.input(z.object({ deviceId: Id })).output(z.object({ ok: z.literal(true) })),
    stop: oc.output(z.object({ ok: z.literal(true) })),
  },
  links: {
    /**
     * The site icon for a link's origin as a small data URL, resolved and cached by the server.
     * `retry` means the server was too busy to look; the origin may still have an icon.
     */
    favicon: oc
      // The longest origin: a scheme, a 253-character host name and a port.
      .input(z.object({ origin: z.string().max("https://".length + 253 + ":65535".length) }))
      .output(z.object({ icon: z.string().nullable(), retry: z.boolean().optional() })),
  },
  runs: {
    list: oc.input(z.object({ filter: z.enum(["active", "recent"]) })).output(RunsListOutputSchema),
    history: oc.input(botId).output(BotRunHistorySchema),
    diagnostics: oc
      .input(z.object({ runId: Id, before: z.number().int().nonnegative().optional() }))
      .output(RunDiagnosticsSchema),
  },
  voice: {
    catalog: oc.output(z.array(VoiceCatalogEntrySchema)),
    status: oc.output(VoiceStatusSchema),
    credentials: oc.output(z.array(VoiceCredentialSchema)),
    connect: oc
      .input(
        z.object({
          provider: z.string(),
          apiKey: z.string().min(8),
          voiceId: z.string().max(120).optional(),
          speechModel: z.string().max(64).optional(),
        }),
      )
      .output(VoiceCredentialSchema),
    disconnect: oc
      .input(z.object({ provider: z.string().min(1) }))
      .output(z.object({ ok: z.literal(true) })),
    setVoice: oc
      .input(z.object({ voiceId: z.string().min(1).max(120), provider: z.string().optional() }))
      .output(VoiceStatusSchema),
    setSpeechModel: oc
      .input(z.object({ provider: z.string().min(1), speechModel: z.string().max(64) }))
      .output(VoiceCredentialSchema),
    voices: oc
      .input(z.object({ provider: z.string().optional() }))
      .output(z.array(VoiceInfoSchema)),
    prepare: oc
      .input(
        z.object({
          text: z.string().max(20000),
          voiceId: z.string().max(120).optional(),
          botId: Id.optional(),
        }),
      )
      .output(z.object({ ready: z.boolean(), utterances: z.array(z.string()) })),
  },
  externalConversations: {
    updatePolicy: oc
      .input(UpdateExternalConversationPolicyInput)
      .output(ExternalConversationPolicySchema),
  },
  agentSecrets: {
    list: oc.output(z.array(AgentSecretSchema)),
    put: oc.input(AgentSecretInputSchema).output(AgentSecretSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  botSecrets: {
    list: oc.input(z.object({ botId: Id })).output(z.array(BotSecretMetadata)),
    put: oc.input(BotSecretPutInput).output(BotSecretMetadata),
    remove: oc
      .input(z.object({ botId: Id, name: StoredBotSecretName }))
      .output(z.object({ ok: z.literal(true) })),
  },
};

export type AppContract = typeof appContract;
