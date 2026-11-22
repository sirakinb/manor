import { oc } from "@orpc/contract";
import * as z from "zod";
import {
  BotCredentialSchema,
  CreateBotCredentialInput,
  UpdateBotCredentialInput,
} from "./bot-credentials.js";
import { BotSchema } from "./bots/bot.js";
import {
  CrmContactSchema,
  CrmDealSchema,
  CrmOverviewSchema,
  CrmPipelineSchema,
  CrmTagSchema,
} from "./crm.js";
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
import { Id } from "./ids.js";
import { LocalComputerLiveSessionSchema, LocalDeviceSchema } from "./local-computer.js";
import {
  MaintenanceApprovalSchema,
  MaintenanceCreateSchema,
  MaintenanceJobSchema,
  MaintenanceOverviewSchema,
} from "./maintenance.js";
import { PublicFormInputSchema, PublicFormSchema } from "./public-forms.js";
import { botId } from "./rpc/inputs.js";
import { TeamMemberSchema } from "./team.js";
import { VerificationSummarySchema } from "./verification.js";
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

const verificationRange = z.object({
  days: z.number().int().min(1).max(90),
  botId: Id.optional(),
});

/** Manor-only procedures, spread into `appContract` beside upstream's topic contracts. */
export const manorRpc = {
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
  credentials: {
    list: oc.input(botId).output(z.array(BotCredentialSchema)),
    create: oc.input(CreateBotCredentialInput).output(BotCredentialSchema),
    update: oc.input(UpdateBotCredentialInput).output(BotCredentialSchema),
    remove: oc.input(z.object({ credentialId: Id })).output(z.object({ ok: z.literal(true) })),
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
};
