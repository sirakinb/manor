import type { JobPublisher, PropertyLedger, TransactionalEmailProvider } from "@rakazo/adapter-kit";
import {
  type BuildiumCredential,
  buildBuildiumChargePayload,
  createBuildiumLedger,
  deleteWorkspaceCredential,
  type EncryptedSecretStore,
  listWorkspaceCredentials,
  loadWorkspaceCredential,
  parseBuildiumCredential,
  requestWorkspaceAutomationRun,
  saveWorkspaceCredential,
  WorkspaceAutomationRequestError,
} from "@rakazo/adapters";
import type {
  Actor,
  ChargePostBatch,
  ChargePostResult,
  ReportGenerateInput,
  ReportSendResult,
  ReportUpdateInput,
  UtilitiesOverview,
  WorkspaceAutomation,
  WorkspaceCredentialRow,
  WorkspaceReport,
  WorkspaceSettings,
  WorkspaceSettingsUpdate,
} from "@rakazo/contracts";
import { ReportGenerateInputSchema } from "@rakazo/contracts";
import {
  applyReportSectionEdits,
  mergeRecipients,
  ReportEditError,
  renderReportEmailHtml,
  renderReportEmailText,
} from "@rakazo/core";
import {
  automationNextRunAt,
  createWorkspaceRepos,
  ensureDefaultAutomations,
  IsolationError,
  listWorkspaceAutomations,
  type PrismaClient,
  updateWorkspaceAutomation,
  type WorkspaceActorScope,
} from "@rakazo/db";

/**
 * The Workspace's write paths: settings, stored provider logins, posting
 * water charges to the property ledger, and editing/approving/sending
 * reports. Reads stay in @rakazo/db; this layer adds the secrets, the
 * ledger, and outbound email, which live behind adapters.
 */

/** A refusal the client should show verbatim (bad state, missing config, no permission). */
export class WorkspaceActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceActionError";
  }
}

export type PropertyLedgerFactory = (credential: BuildiumCredential) => PropertyLedger;

export interface WorkspaceActionDeps {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  /** Builds the ledger for a workspace's Buildium credential; tests inject a fake. */
  propertyLedger?: PropertyLedgerFactory;
  /** Absent when the deployment has no outbound email configured. */
  email?: TransactionalEmailProvider;
  /** Enqueues "run now" automation jobs; absent in tests that never run one. */
  jobs?: JobPublisher;
  now?: () => Date;
}

type ChargeActor = Pick<Actor, "organizationId" | "userId" | "email">;
const ERROR_TEXT_MAX = 300;

const day = (value: Date): string => value.toISOString().slice(0, 10);
const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;
const truncate = (value: string): string => value.slice(0, ERROR_TEXT_MAX);

function mapReport(row: {
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
  summary: string | null;
  report: unknown;
}): WorkspaceReport {
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
    summary: row.summary,
    report: row.report,
  };
}

function mapSettings(row: {
  activityApproval: string;
  monthlyVoiceReportsEnabled: boolean;
  monthlyVoiceReportDay: number;
  monthlyVoiceReportHour: number;
  weeklyEmailReportsEnabled: boolean;
  weeklyEmailReportDay: number;
  weeklyEmailReportHour: number;
  reportRecipient: string | null;
  reportReviewerEmail: string | null;
  waterGlAccountId: number | null;
  buildiumChargeDescription: string;
}): WorkspaceSettings {
  return {
    activityApproval: row.activityApproval === "auto" ? "auto" : "manual",
    monthlyVoiceReportsEnabled: row.monthlyVoiceReportsEnabled,
    monthlyVoiceReportDay: row.monthlyVoiceReportDay,
    monthlyVoiceReportHour: row.monthlyVoiceReportHour,
    weeklyEmailReportsEnabled: row.weeklyEmailReportsEnabled,
    weeklyEmailReportDay: row.weeklyEmailReportDay,
    weeklyEmailReportHour: row.weeklyEmailReportHour,
    reportRecipient: row.reportRecipient,
    reportReviewerEmail: row.reportReviewerEmail,
    waterGlAccountId: row.waterGlAccountId,
    buildiumChargeDescription: row.buildiumChargeDescription,
  };
}

function mapCredential(row: {
  provider: string;
  label: string;
  fields: string[];
  updatedAt: Date;
}): WorkspaceCredentialRow {
  return {
    provider: row.provider as WorkspaceCredentialRow["provider"],
    label: row.label,
    fields: row.fields,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createWorkspaceActions(deps: WorkspaceActionDeps) {
  const { prisma, secrets } = deps;
  const now = deps.now ?? (() => new Date());
  const ledgerFor = deps.propertyLedger ?? ((credential) => createBuildiumLedger(credential));
  const reads = createWorkspaceRepos(prisma, { now });

  async function requireWorkspace(actor: WorkspaceActorScope) {
    const row = await prisma.workspace.findUnique({
      where: { organizationId: actor.organizationId },
    });
    if (!row) throw new IsolationError("No workspace");
    return row;
  }

  /** Organization owners and admins only, read from the `member` row like the CRM does. */
  async function requireManager(actor: ChargeActor) {
    const member = await prisma.member.findFirst({
      where: { organizationId: actor.organizationId, userId: actor.userId },
      select: { role: true },
    });
    const roles = (member?.role ?? "").split(",").map((role) => role.trim());
    if (!roles.includes("owner") && !roles.includes("admin")) {
      throw new WorkspaceActionError("Only organization owners and admins can change this");
    }
  }

  async function requireReport(actor: WorkspaceActorScope, reportId: string) {
    const workspace = await requireWorkspace(actor);
    const row = await prisma.workspaceReport.findUnique({ where: { id: reportId } });
    if (!row || row.workspaceId !== workspace.id) throw new IsolationError();
    return { workspace, row };
  }

  async function logActivity(input: {
    workspaceId: string;
    channel: string;
    kind: string;
    title: string;
    summary: string | null;
    actor: string;
    payload: unknown;
  }) {
    await prisma.workspaceActivity.create({
      data: {
        workspaceId: input.workspaceId,
        channel: input.channel,
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        payload: input.payload as never,
        status: "completed",
        actor: input.actor,
        verification: "approved",
        verifiedBy: input.actor,
        verifiedAt: now(),
      },
    });
  }

  // ── Charges ────────────────────────────────────────────────────────────

  /** The bill and its per-lease charge exactly as utilities.overview resolves them. */
  async function resolveCharge(
    actor: WorkspaceActorScope,
    waterBillId: string,
    leaseId: number,
  ): Promise<{
    overview: UtilitiesOverview;
    bill: UtilitiesOverview["bills"][number];
    charge: UtilitiesOverview["bills"][number]["charges"][number];
  }> {
    const overview = await reads.utilitiesOverview(actor);
    const bill = overview.bills.find((candidate) => candidate.waterBillId === waterBillId);
    if (!bill) throw new IsolationError();
    if (bill.billingMode && bill.billingMode !== "pass_through")
      throw new WorkspaceActionError(
        "This property's billing mode does not allow pass-through charges",
      );
    if (bill.resolutionStatus !== "resolved") {
      throw new WorkspaceActionError(
        `This bill is ${bill.resolutionStatus.replace("_", " ")}; match it to a property with an active lease first`,
      );
    }
    const charge = bill.charges.find((candidate) => candidate.leaseId === leaseId);
    if (!charge) throw new WorkspaceActionError("That lease does not carry a share of this bill");
    return { overview, bill, charge };
  }

  async function postOne(
    actor: ChargeActor,
    workspace: { id: string; waterGlAccountId: number | null; buildiumChargeDescription: string },
    ledger: PropertyLedger | null,
    input: {
      waterBillId: string;
      leaseId: number;
      amount?: number;
      memo?: string;
      chargeDate?: string;
      dryRun: boolean;
    },
  ): Promise<ChargePostResult> {
    const { bill, charge } = await resolveCharge(actor, input.waterBillId, input.leaseId);
    if (charge.postStatus === "posted") {
      throw new WorkspaceActionError("This charge was already posted");
    }
    if (workspace.waterGlAccountId === null) {
      throw new WorkspaceActionError(
        "Set the water GL account in workspace settings before posting charges",
      );
    }
    const amount = input.amount ?? charge.postedAmount ?? charge.chargeAmount;
    if (amount === null || amount === undefined) {
      throw new WorkspaceActionError("This bill has no amount to charge");
    }
    const memo = (input.memo ?? charge.postedMemo ?? bill.memo ?? "Water bill").trim();
    const ledgerCharge = {
      date: input.chargeDate ?? day(now()),
      memo,
      amount,
      accountId: workspace.waterGlAccountId,
      description: workspace.buildiumChargeDescription,
    };
    const payload = buildBuildiumChargePayload(ledgerCharge);
    if (input.dryRun) {
      return {
        waterBillId: input.waterBillId,
        leaseId: input.leaseId,
        status: "dry_run",
        amount,
        memo,
        buildiumChargeId: null,
        error: null,
        payload,
      };
    }
    if (!ledger) {
      throw new WorkspaceActionError("Add the Buildium credential before posting charges");
    }
    let status: "posted" | "error" = "posted";
    let buildiumChargeId: number | null = null;
    let error: string | null = null;
    try {
      buildiumChargeId = (await ledger.postCharge(input.leaseId, ledgerCharge)).externalId;
    } catch (failure) {
      status = "error";
      error = truncate(failure instanceof Error ? failure.message : String(failure));
    }
    const postedAt = now();
    await prisma.workspaceWaterBillChargePost.upsert({
      where: { waterBillId_leaseId: { waterBillId: input.waterBillId, leaseId: input.leaseId } },
      create: {
        workspaceId: workspace.id,
        waterBillId: input.waterBillId,
        leaseId: input.leaseId,
        amount,
        memo,
        glAccountId: workspace.waterGlAccountId,
        status,
        buildiumChargeId,
        error,
        postedAt,
        postedBy: actor.email,
      },
      update: {
        amount,
        memo,
        glAccountId: workspace.waterGlAccountId,
        status,
        buildiumChargeId,
        error,
        postedAt,
        postedBy: actor.email,
      },
    });
    return {
      waterBillId: input.waterBillId,
      leaseId: input.leaseId,
      status,
      amount,
      memo,
      buildiumChargeId,
      error,
      payload: null,
    };
  }

  async function ledgerForWorkspace(workspaceId: string): Promise<PropertyLedger | null> {
    const fields = await loadWorkspaceCredential(prisma, secrets, workspaceId, "buildium");
    if (!fields) return null;
    return ledgerFor(parseBuildiumCredential(fields));
  }

  return {
    // ── Automations ──────────────────────────────────────────────────────

    /** Seeds the registry for the workspace's channels on first sight, then lists. */
    async listAutomations(actor: WorkspaceActorScope): Promise<WorkspaceAutomation[]> {
      const workspace = await requireWorkspace(actor);
      await ensureDefaultAutomations(prisma, workspace, now());
      return listWorkspaceAutomations(prisma, workspace.id, now());
    },

    /** Enqueue one run immediately; the sync-run row exists before the job does. */
    async runAutomation(actor: ChargeActor, key: string): Promise<{ runId: string }> {
      try {
        return await requestWorkspaceAutomationRun(prisma, deps.jobs, actor, key, now());
      } catch (error) {
        if (error instanceof WorkspaceAutomationRequestError)
          throw new WorkspaceActionError(error.message);
        throw error;
      }
    },

    async updateAutomation(
      actor: ChargeActor,
      input: { key: string; enabled?: boolean; crons?: string[] },
    ): Promise<WorkspaceAutomation> {
      const workspace = await requireWorkspace(actor);
      await requireManager(actor);
      await ensureDefaultAutomations(prisma, workspace, now());
      try {
        return await updateWorkspaceAutomation(prisma, workspace.id, input, now());
      } catch (error) {
        if (error instanceof RangeError) throw new WorkspaceActionError(error.message);
        throw error;
      }
    },

    // ── Settings ─────────────────────────────────────────────────────────

    async getSettings(actor: WorkspaceActorScope): Promise<WorkspaceSettings> {
      const workspace = await requireWorkspace(actor);
      const automations = await prisma.workspaceAutomation.findMany({
        where: { workspaceId: workspace.id, key: { in: ["recap", "email-recap"] } },
      });
      return {
        ...mapSettings(workspace),
        emailDelivery: deps.email
          ? {
              provider: deps.email.describe().displayName ?? deps.email.describe().id,
              connected: deps.email.describe().capabilities.transactional,
            }
          : null,
        monthlyVoiceReportsEnabled:
          workspace.monthlyVoiceReportsEnabled &&
          (automations.find((row) => row.key === "recap")?.enabled ?? true),
        weeklyEmailReportsEnabled:
          workspace.weeklyEmailReportsEnabled &&
          (automations.find((row) => row.key === "email-recap")?.enabled ?? false),
      };
    },

    async updateSettings(
      actor: ChargeActor,
      input: WorkspaceSettingsUpdate,
    ): Promise<WorkspaceSettings> {
      const workspace = await requireWorkspace(actor);
      await requireManager(actor);
      if (
        input.monthlyVoiceReportsEnabled !== undefined ||
        input.weeklyEmailReportsEnabled !== undefined
      )
        await ensureDefaultAutomations(prisma, workspace, now());
      await prisma.$transaction(async (tx) => {
        await tx.workspace.update({
          where: { id: workspace.id },
          data: {
            activityApproval: input.activityApproval,
            monthlyVoiceReportsEnabled: input.monthlyVoiceReportsEnabled,
            monthlyVoiceReportDay: input.monthlyVoiceReportDay,
            monthlyVoiceReportHour: input.monthlyVoiceReportHour,
            weeklyEmailReportsEnabled: input.weeklyEmailReportsEnabled,
            weeklyEmailReportDay: input.weeklyEmailReportDay,
            weeklyEmailReportHour: input.weeklyEmailReportHour,
            reportRecipient:
              input.reportRecipient === undefined ? undefined : input.reportRecipient || null,
            reportReviewerEmail:
              input.reportReviewerEmail === undefined
                ? undefined
                : input.reportReviewerEmail || null,
            waterGlAccountId: input.waterGlAccountId,
            buildiumChargeDescription: input.buildiumChargeDescription,
          },
        });
        for (const [key, enabled] of [
          ["recap", input.monthlyVoiceReportsEnabled],
          ["email-recap", input.weeklyEmailReportsEnabled],
        ] as const) {
          if (enabled === undefined) continue;
          const automation = await tx.workspaceAutomation.findUnique({
            where: { workspaceId_key: { workspaceId: workspace.id, key } },
          });
          if (automation)
            await tx.workspaceAutomation.update({
              where: { id: automation.id },
              data: {
                enabled,
                nextRunAt: enabled
                  ? automationNextRunAt(automation.crons, automation.timezone, now())
                  : null,
              },
            });
        }
      });
      return this.getSettings(actor);
    },

    // ── Credentials ──────────────────────────────────────────────────────

    async listCredentials(actor: WorkspaceActorScope): Promise<WorkspaceCredentialRow[]> {
      const workspace = await requireWorkspace(actor);
      return (await listWorkspaceCredentials(prisma, secrets, workspace.id)).map(mapCredential);
    },

    async setCredential(
      actor: ChargeActor,
      input: { provider: string; label?: string; fields: Record<string, string> },
    ): Promise<WorkspaceCredentialRow> {
      const workspace = await requireWorkspace(actor);
      await requireManager(actor);
      const saved = await saveWorkspaceCredential(
        prisma,
        secrets,
        { workspaceId: workspace.id, userId: actor.userId },
        input,
      );
      return mapCredential(saved);
    },

    async removeCredential(actor: ChargeActor, provider: string): Promise<void> {
      const workspace = await requireWorkspace(actor);
      await requireManager(actor);
      await deleteWorkspaceCredential(prisma, workspace.id, provider);
    },

    // ── Charges ──────────────────────────────────────────────────────────

    /** Edit the amount or memo ahead of posting. A skipped charge comes back to pending. */
    async saveCharge(
      actor: ChargeActor,
      input: { waterBillId: string; leaseId: number; amount?: number; memo?: string },
    ): Promise<UtilitiesOverview> {
      const workspace = await requireWorkspace(actor);
      const { bill, charge } = await resolveCharge(actor, input.waterBillId, input.leaseId);
      if (charge.postStatus === "posted") {
        throw new WorkspaceActionError("This charge was already posted");
      }
      const amount = input.amount ?? charge.postedAmount ?? charge.chargeAmount ?? 0;
      const memo = input.memo ?? charge.postedMemo ?? bill.memo ?? "Water bill";
      await prisma.workspaceWaterBillChargePost.upsert({
        where: { waterBillId_leaseId: { waterBillId: input.waterBillId, leaseId: input.leaseId } },
        create: {
          workspaceId: workspace.id,
          waterBillId: input.waterBillId,
          leaseId: input.leaseId,
          amount,
          memo,
          status: "pending",
        },
        update: { amount, memo, status: "pending", error: null },
      });
      return reads.utilitiesOverview(actor);
    },

    async skipCharge(
      actor: ChargeActor,
      input: { waterBillId: string; leaseId: number },
    ): Promise<UtilitiesOverview> {
      const workspace = await requireWorkspace(actor);
      const { bill, charge } = await resolveCharge(actor, input.waterBillId, input.leaseId);
      if (charge.postStatus === "posted") {
        throw new WorkspaceActionError("This charge was already posted");
      }
      await prisma.workspaceWaterBillChargePost.upsert({
        where: { waterBillId_leaseId: { waterBillId: input.waterBillId, leaseId: input.leaseId } },
        create: {
          workspaceId: workspace.id,
          waterBillId: input.waterBillId,
          leaseId: input.leaseId,
          amount: charge.postedAmount ?? charge.chargeAmount ?? 0,
          memo: charge.postedMemo ?? bill.memo ?? "Water bill",
          status: "skipped",
        },
        update: { status: "skipped" },
      });
      return reads.utilitiesOverview(actor);
    },

    async postCharge(
      actor: ChargeActor,
      input: {
        waterBillId: string;
        leaseId: number;
        amount?: number;
        memo?: string;
        chargeDate?: string;
        dryRun: boolean;
      },
    ): Promise<ChargePostResult> {
      const workspace = await requireWorkspace(actor);
      const ledger = input.dryRun ? null : await ledgerForWorkspace(workspace.id);
      const result = await postOne(actor, workspace, ledger, input);
      if (result.status !== "dry_run") {
        await logActivity({
          workspaceId: workspace.id,
          channel: "utilities",
          kind: "charge_posted",
          title:
            result.status === "posted"
              ? `Posted $${result.amount.toFixed(2)} water charge to lease ${result.leaseId}`
              : `Water charge to lease ${result.leaseId} failed`,
          summary: result.status === "posted" ? result.memo : result.error,
          actor: actor.email,
          payload: {
            waterBillId: result.waterBillId,
            leaseId: result.leaseId,
            amount: result.amount,
            memo: result.memo,
            status: result.status,
            buildiumChargeId: result.buildiumChargeId,
            error: result.error,
          },
        });
      }
      return result;
    },

    /** Every resolved, still-pending charge; a failure is recorded and the batch continues. */
    async postAllPending(actor: ChargeActor, input: { dryRun: boolean }): Promise<ChargePostBatch> {
      const workspace = await requireWorkspace(actor);
      const overview = await reads.utilitiesOverview(actor);
      const targets = overview.bills
        .filter((bill) => bill.resolutionStatus === "resolved")
        .sort(
          (a, b) =>
            (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
            a.waterBillId.localeCompare(b.waterBillId),
        )
        .flatMap((bill) =>
          bill.charges
            .filter((charge) => charge.postStatus === "pending")
            .sort((a, b) => a.leaseId - b.leaseId)
            .map((charge) => ({ waterBillId: bill.waterBillId, leaseId: charge.leaseId })),
        );
      const ledger = input.dryRun ? null : await ledgerForWorkspace(workspace.id);
      const results: ChargePostResult[] = [];
      for (const target of targets) {
        try {
          results.push(
            await postOne(actor, workspace, ledger, { ...target, dryRun: input.dryRun }),
          );
        } catch (failure) {
          results.push({
            ...target,
            status: "error",
            amount: 0,
            memo: "",
            buildiumChargeId: null,
            error: truncate(failure instanceof Error ? failure.message : String(failure)),
            payload: null,
          });
        }
      }
      const posted = results.filter((result) => result.status === "posted").length;
      const failed = results.filter((result) => result.status === "error").length;
      if (!input.dryRun && results.length > 0) {
        await logActivity({
          workspaceId: workspace.id,
          channel: "utilities",
          kind: "charge_posted",
          title: `Posted ${posted} of ${results.length} pending water charges`,
          summary: failed ? `${failed} failed` : null,
          actor: actor.email,
          payload: {
            batch: true,
            posted,
            failed,
            results: results.map((result) => ({
              waterBillId: result.waterBillId,
              leaseId: result.leaseId,
              amount: result.amount,
              status: result.status,
              buildiumChargeId: result.buildiumChargeId,
              error: result.error,
            })),
          },
        });
      }
      return { dryRun: input.dryRun, posted, failed, results };
    },

    // ── Reports ──────────────────────────────────────────────────────────

    async generateReport(actor: ChargeActor, input: ReportGenerateInput): Promise<WorkspaceReport> {
      await requireManager(actor);
      const parsed = ReportGenerateInputSchema.safeParse(input);
      if (!parsed.success)
        throw new WorkspaceActionError(
          "Choose a valid report audience and date range (up to 366 days)",
        );
      const workspace = await requireWorkspace(actor);
      const channel = input.kind === "email" ? "email" : "voice";
      if (!workspace.channels.includes(channel))
        throw new WorkspaceActionError("This report channel is not enabled");
      if (!deps.jobs) throw new WorkspaceActionError("Report generation is not configured");
      const credential =
        (await loadWorkspaceCredential(prisma, secrets, workspace.id, "openai")) ??
        (await loadWorkspaceCredential(prisma, secrets, workspace.id, "openrouter"));
      if (!credential?.apiKey)
        throw new WorkspaceActionError(
          "Add a narrative provider in workspace settings before generating reports",
        );
      if (
        input.kind === "monthly_voice" &&
        (input.from.slice(8) !== "01" ||
          input.from.slice(0, 7) !== input.to.slice(0, 7) ||
          new Date(Date.parse(input.to) + 86_400_000).getUTCDate() !== 1)
      )
        throw new WorkspaceActionError("A monthly recap needs a complete calendar month");
      const row = await prisma.workspaceReport.create({
        data: {
          workspaceId: workspace.id,
          reportType: channel,
          title: `${channel === "email" ? "Email campaign report" : input.kind === "monthly_voice" ? "Monthly voice recap" : "Voice report"}${input.agentType ? ` (${input.agentType === "tenant" ? "Tenants" : "Landlords"})` : ""} · ${input.from} – ${input.to}`,
          status: "queued",
          dateRangeStart: new Date(input.from),
          dateRangeEnd: new Date(input.to),
          report: { request: parsed.data },
          generatedBy: actor.email,
        },
      });
      try {
        await deps.jobs.enqueue({
          name: "workspace.report.generate",
          payload: { reportId: row.id },
          replaceKey: `workspace-report:${row.id}`,
        });
      } catch {
        await prisma.workspaceReport.update({
          where: { id: row.id },
          data: { status: "error", summary: "Could not queue this report. Generate it again." },
        });
        throw new WorkspaceActionError("Could not queue the report. Please try again.");
      }
      return mapReport(row);
    },

    async testReportEmail(
      actor: ChargeActor,
      input: { reportId: string; to: string },
    ): Promise<{ ok: true }> {
      await requireManager(actor);
      const { workspace, row } = await requireReport(actor, input.reportId);
      if (!["draft", "final"].includes(row.status))
        throw new WorkspaceActionError("Wait for a finished report before testing email");
      if (!deps.email) throw new WorkspaceActionError("Email sending is not configured");
      const report = mapReport(row);
      try {
        await deps.email.send({
          to: input.to,
          subject: `[Test] ${workspace.name} — ${row.title}`,
          html: renderReportEmailHtml({ workspaceName: workspace.name, report }),
          text: renderReportEmailText({ workspaceName: workspace.name, report }),
        });
      } catch {
        throw new WorkspaceActionError(
          "The test email could not be sent. Check email configuration and try again.",
        );
      }
      return { ok: true };
    },

    async updateReport(actor: ChargeActor, input: ReportUpdateInput): Promise<WorkspaceReport> {
      const { row } = await requireReport(actor, input.reportId);
      if (!["draft", "final"].includes(row.status))
        throw new WorkspaceActionError("This report is not ready to edit");
      if (row.approvedAt) {
        throw new WorkspaceActionError(
          "This report was already approved and sent; it can no longer be edited",
        );
      }
      let report: unknown;
      if (input.sections) {
        try {
          report = applyReportSectionEdits(row.report, input.sections);
        } catch (error) {
          if (error instanceof ReportEditError) throw new WorkspaceActionError(error.message);
          throw error;
        }
      }
      const updated = await prisma.workspaceReport.update({
        where: { id: row.id },
        data: {
          title: input.title,
          summary: input.summary,
          ...(report === undefined ? {} : { report: report as never }),
          editedAt: now(),
          editedBy: actor.email,
        },
      });
      return mapReport(updated);
    },

    async approveReport(actor: ChargeActor, reportId: string): Promise<WorkspaceReport> {
      const { row } = await requireReport(actor, reportId);
      if (!["draft", "final"].includes(row.status))
        throw new WorkspaceActionError("This report is not ready to approve");
      if (row.approvedAt) return mapReport(row);
      const updated = await prisma.workspaceReport.update({
        where: { id: row.id },
        data: { approvedAt: now(), approvedBy: actor.email },
      });
      return mapReport(updated);
    },

    /**
     * Email the rendered report. Approval is recorded when at least one copy
     * went out, so a partial failure never leaves the report looking unsent
     * and a retry does not re-send to the addresses that already got it.
     */
    async sendReport(
      actor: ChargeActor,
      input: { reportId: string; to: string[] },
    ): Promise<ReportSendResult> {
      const { workspace, row } = await requireReport(actor, input.reportId);
      if (!["draft", "final"].includes(row.status))
        throw new WorkspaceActionError("This report is not ready to send");
      if (!deps.email) {
        throw new WorkspaceActionError(
          "Email sending is not configured on this deployment (set SMTP_URL and EMAIL_FROM)",
        );
      }
      const renderable = mapReport(row);
      const html = renderReportEmailHtml({ workspaceName: workspace.name, report: renderable });
      const text = renderReportEmailText({ workspaceName: workspace.name, report: renderable });
      const subject = `${workspace.name} — ${row.title}`;
      const sent: string[] = [];
      let error: string | null = null;
      for (const to of input.to) {
        try {
          await deps.email.send({ to, subject, text, html });
          sent.push(to);
        } catch (failure) {
          const reason = failure instanceof Error ? failure.message : String(failure);
          error = `Failed sending to ${to}: ${truncate(reason)}`;
          break;
        }
      }
      let latest = row;
      if (sent.length > 0) {
        const at = now();
        latest = await prisma.workspaceReport.update({
          where: { id: row.id },
          data: {
            status: "final",
            approvedAt: row.approvedAt ?? at,
            approvedBy: row.approvedBy ?? actor.email,
            sentAt: at,
            sentTo: mergeRecipients(row.sentTo, sent),
          },
        });
        await logActivity({
          workspaceId: workspace.id,
          channel: row.reportType.startsWith("email") ? "email" : "voice",
          kind: "report_sent",
          title: `Sent "${row.title}" to ${sent.length} recipient${sent.length === 1 ? "" : "s"}`,
          summary: sent.join(", "),
          actor: actor.email,
          payload: { reportId: row.id, reportType: row.reportType, sent, error },
        });
      }
      return { report: mapReport(latest), sent, error };
    },

    /** Drafts only, by status: final reports (like the imported recaps) and anything approved or sent stay. */
    async removeReport(actor: ChargeActor, reportId: string): Promise<void> {
      const { row } = await requireReport(actor, reportId);
      if (row.status !== "draft" || row.approvedAt || row.sentAt) {
        throw new WorkspaceActionError("Only draft reports can be deleted");
      }
      await prisma.workspaceReport.delete({ where: { id: row.id } });
    },
  };
}

export type WorkspaceActions = ReturnType<typeof createWorkspaceActions>;
