import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { ORPCError } from "@orpc/server";
import type {
  AdapterContext,
  AgentHomeStore,
  ArtifactStore,
  JobPublisher,
  MaintenanceAdapter,
  MemoryStore,
  NotificationProvider,
  PaymentWalletProvider,
  ProductAnalytics,
  SandboxProvider,
  SecretStore,
  TransactionalEmailProvider,
} from "@rakazo/adapter-kit";
import { maintenanceAdvanceJob } from "@rakazo/adapter-kit";
import type {
  CloudAgentConnection,
  CodexLiveCatalog,
  ConnectorRegistry,
  createPageRevisions,
  FaviconResolver,
  IntegrationProviderSettings,
  McpConnector,
  McpOAuthBroker,
  MeetingCalendarService,
  MeetingService,
  MemoryProviderResolver,
  MessagingDelivery,
  MessagingInstallations,
  PiOAuthLogins,
  PlanLimitsReader,
  PluginRepoFetcher,
  PluginTextReader,
  ProviderCatalogCache,
  PushTokenStore,
  RemoteConnectorDependencies,
  TicketChangeNotifier,
  UserCloudAgents,
  verifyModelServesAgents,
  WorkActivities,
} from "@rakazo/adapters";
import {
  BOT_CREDENTIAL_SECRET_KIND,
  createMaintenanceService,
  loadBotCredentialSecret,
  MaintenanceError,
  manageWorkspaceFiles,
  provisionComputer,
  requireMaintenanceOwner,
  resolveBotWorkspaceCwd,
  resolveBotWorkspacePath,
  scheduleComputerSleep,
  screenLeaseIdForRun,
  serializeBotCredentialSecret,
  toComputerRef,
  touchRunningComputer,
  VERIFICATION_ENGINE_LABELS,
  WorkspaceFileError,
  workspaceFilesLeaseKey,
} from "@rakazo/adapters";
import type { Auth } from "@rakazo/auth";
import type { Actor, LabFeature, ModelCredential, NavLink } from "@rakazo/contracts";
import { workspaceOperationMutates } from "@rakazo/contracts";
import type { VerificationCheckInput } from "@rakazo/core";
import {
  ACTIVE_RUN_STATUSES,
  checksStartingSince,
  summarizeVerification,
  verificationReportCsv,
  verificationReportMarkdown,
} from "@rakazo/core";
import type { BoardEvents, PrismaClient, ThreadEvents } from "@rakazo/db";
import {
  CrmModuleValueError,
  createCrmRepos,
  createTeamRepos,
  createWorkspaceRepos,
  IsolationError,
  LeaseHeldError,
  parseComputerMode,
  withLease,
} from "@rakazo/db";
import type { BillingService } from "./billing/billing.js";
import type { VoiceDeps } from "./calls/voice.js";
import type { WorkspaceRepo } from "./computer-changes.js";
import {
  findGitRepositoriesArgv,
  gitDiffArgv,
  gitStatusArgv,
  isSafeRepoRelativePath,
  parseGitStatus,
  parseRepositoryList,
  runInComputer,
  truncateDiff,
} from "./computer-changes.js";
import { addPreviewProxyCapability } from "./computers/screen-proxy.js";
import type { AppEnv } from "./env.js";
import {
  listLocalDevices,
  localComputerLiveSession,
  registerLocalDevice,
  revokeLocalDevice,
  stopLocalComputerSessions,
} from "./local-computer.js";
import { meetingCalendarRoutes } from "./meetings/calendar/calendar-routes.js";
import type { createMeetingAnswers } from "./meetings/meeting-answers.js";
import { meetingRoutes } from "./meetings/meeting-routes.js";
import { accountRoutes } from "./routes/account.js";
import { availabilityRoutes } from "./routes/availability.js";
import { boardsRoutes } from "./routes/boards.js";
import { botsRoutes } from "./routes/bots.js";
import { capabilitiesRoutes } from "./routes/capabilities.js";
import { computerRoutes } from "./routes/computer.js";
import { computerProviderRoutes } from "./routes/computer-provider.js";
import { connectionsRoutes } from "./routes/connections.js";
import { contentRoutes } from "./routes/content.js";
import type { RouterContext } from "./routes/context.js";
import { createRouterContext } from "./routes/context.js";
import { mcpRoutes } from "./routes/mcp.js";
import { memoryRoutes } from "./routes/memory.js";
import { messagingRoutes } from "./routes/messaging.js";
import { modelsRoutes } from "./routes/models.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { organizationsRoutes } from "./routes/organizations.js";
import { pagesRoutes } from "./routes/pages.js";
import { paymentWalletRoutes } from "./routes/payment-wallet.js";
import { routinesRoutes } from "./routes/routines.js";
import { computerContext } from "./routes/shared.js";
import { spacesRoutes } from "./routes/spaces.js";
import { spendingLimitRoutes } from "./routes/spending-limit.js";
import { threadsRoutes } from "./routes/threads.js";
import { getRunDiagnostics, listBotRunHistory } from "./threads/runs.js";
import { workspaceAccess } from "./workspace-access.js";
import type { PropertyLedgerFactory } from "./workspace-actions.js";
import { createWorkspaceActions, WorkspaceActionError } from "./workspace-actions.js";
import { createWorkspaceTeam } from "./workspace-team.js";

export { botIntroPrompt } from "./bots/hidden-turns.prompt.js";
export { nextConnectionLabel } from "./models/model-credentials.js";
export { enqueueBotIntroRun } from "./routes/bots.js";
export { HEARTBEAT_MS, SESSION_RECHECK_MS } from "./routes/shared.js";
export { callMarkerClientNonce } from "./routes/threads.js";

export interface RouterDeps {
  maintenance?: MaintenanceAdapter;
  /** Manor: tests only; production uses `ORGANIZATION_CHANGES_AVAILABLE`. */
  organizationChangesAvailable?: boolean;
  /** Manor: tests only; production uses `SPACE_SHARING_AVAILABLE`. */
  spaceSharingAvailable?: boolean;
  /** Manor: tests only; production uses `PAGE_REVIEW_OUTSIDE_ORGANIZATION_AVAILABLE`. */
  pageReviewOutsideOrganizationAvailable?: boolean;
  meetings?: MeetingService;
  meetingCalendar?: MeetingCalendarService;
  meetingAnswers?: ReturnType<typeof createMeetingAnswers>;
  pushTokens: PushTokenStore;
  /** Absent when the deployment cannot update a phone's live status card. */
  workActivities?: Pick<WorkActivities, "register" | "registerStarts">;
  /** Stops a call's ring on the owner's other devices once it is settled. */
  notifications?: NotificationProvider;
  analytics?: ProductAnalytics;
  cloudAgent?: CloudAgentConnection | null;
  userCloudAgents?: UserCloudAgents;
  /** The deployment's wallet provider; absent hides purchases. */
  paymentWallet?: PaymentWalletProvider | null;
  prisma: PrismaClient;
  events: ThreadEvents;
  boardEvents: BoardEvents;
  ticketChanges: TicketChangeNotifier;
  auth: Auth;
  jobs: JobPublisher;
  pageRevisions?: Pick<ReturnType<typeof createPageRevisions>, "start" | "recipient">;
  sandbox: SandboxProvider;
  memory: MemoryStore;
  memoryProviders: MemoryProviderResolver;
  home: AgentHomeStore;
  secrets: SecretStore;
  /** Outbound email for report sending and plugin submission mail; absent when SMTP is not configured. */
  email?: TransactionalEmailProvider;
  /** Builds the property ledger for a workspace's Buildium credential. */
  propertyLedger?: PropertyLedgerFactory;
  oauthLogins: PiOAuthLogins<ModelCredential>;
  /** Live Codex catalog seam; defaults to the shared per-process cache. */
  codexCatalog?: CodexLiveCatalog;
  providerCatalog?: ProviderCatalogCache;
  /** Subscription allowance readings; defaults to the shared per-process cache. */
  planLimits?: PlanLimitsReader;
  /** HTTP transport for model connection checks and catalog probes. */
  modelConnectionFetch?: typeof fetch;
  /** One real request proving a newly keyed model can serve agents; absent skips it. */
  modelConnectionCheck?: typeof verifyModelServesAgents;
  /** Site icons for links; defaults to the per-process cache that fetches them. */
  favicons?: FaviconResolver;
  /** Detached refresh for an expired bearer, so the live catalog never refreshes inline. */
  refreshExpiredModelCredential?: (
    scope: { userId: string; spaceId: string },
    secretId: string,
    provider: string,
  ) => void;
  integrationSettings?: IntegrationProviderSettings;
  mcpOAuth?: McpOAuthBroker;
  /** Probes MCP server health; without it servers are never probed from here. */
  mcp?: Pick<McpConnector, "probe">;
  connectors: ConnectorRegistry;
  remoteConnectors?: RemoteConnectorDependencies;
  pluginRepoFetcher?: PluginRepoFetcher;
  pluginMarketplaceRead?: PluginTextReader;
  artifacts: ArtifactStore;
  dataDir: string;
  messagingInstallations?: MessagingInstallations;
  /** Sends replies to the chat apps people message from; absent without one. */
  messagingDelivery?: MessagingDelivery;
  messaging?: {
    enabled: boolean;
    providers: string[];
    addresses: Record<string, string>;
    resolveAddresses?: (signal?: AbortSignal) => Promise<Record<string, string>>;
    openSignup: boolean;
  };
  crmEvent?: (
    organizationId: string,
    type:
      | "contact.created"
      | "contact.updated"
      | "deal.created"
      | "deal.updated"
      | "deal.stage_changed"
      | "record.created"
      | "record.updated",
    resourceId: string,
    payload: unknown,
  ) => Promise<void>;
  /** Present only when the deployment bills; self-hosted installs leave it unset. */
  billing?: BillingService;
  onEmailError?: (error: unknown) => void;
  speechSummary?: VoiceDeps["speechSummary"];
  env: {
    deploymentVoice?: NonNullable<VoiceDeps["env"]>["deploymentVoice"];
    /** Domain of bots' email addresses; unset when this server receives no email. */
    inboundEmailDomain?: string;
    navLinks?: NavLink[];
    adminEmails?: string[];
    /** Labs features this deployment turns on for every account. */
    deploymentLabs?: LabFeature[];
    phoneCallsEnabled?: boolean;
    phoneCallRingSeconds?: number;
    maxUploadSizeBytes?: number;
    maxAttachmentsPerMessage?: number;
    agentRuntime: string;
    teamChatJudgeProvider?: string;
    teamChatJudgeModel?: string;
    defaultProvider: string;
    defaultModel: string;
    deploymentModelConfigured?: boolean;
    deploymentModelHostCredentials?: boolean;
    webOrigin: string;
    privacyPolicyUrl?: string;
    screenProxySecret: string;
    /** Keys the hash that names an invited address in the security log, so it can't be guessed. */
    invitationRecipientKey: string;
    sandboxProvider: string;
    gitSha?: string;
    integrationsCatalogUrl?: string;
    mcpAllowPrivateEndpoint?: boolean;
    desktopHostChoiceEnabled?: boolean;
    computerSettingsEnabled?: boolean;
    mcpStdioEnabled?: boolean;
    mcpStdioAllowedCommands?: string[];
  };
}

export function createRouter(deps: RouterDeps) {
  const ctx = createRouterContext(deps);
  const { os } = ctx;
  const computer = computerRoutes(ctx);
  const content = contentRoutes(ctx);

  return os.router({
    ...accountRoutes(ctx),
    ...meetingRoutes(ctx),
    ...meetingCalendarRoutes(ctx),
    ...spacesRoutes(ctx),
    ...organizationsRoutes(ctx),
    ...modelsRoutes(ctx),
    ...botsRoutes(ctx),
    ...threadsRoutes(ctx),
    ...computer,
    ...computerProviderRoutes(ctx),
    ...memoryRoutes(ctx),
    ...routinesRoutes(ctx),
    ...boardsRoutes(ctx),
    ...capabilitiesRoutes(ctx),
    ...mcpRoutes(ctx),
    ...onboardingRoutes(ctx),
    ...availabilityRoutes(ctx),
    ...connectionsRoutes(ctx),
    ...messagingRoutes(ctx),
    ...content,
    ...pagesRoutes(ctx),
    ...paymentWalletRoutes(ctx),
    ...spendingLimitRoutes(ctx),
    // Manor-owned areas, and Manor's procedures inside upstream's computer and runs groups.
    ...manorRoutes(ctx, { computer: computer.computer, runs: content.runs }),
  });
}

/**
 * Manor's own procedures: the team list, the maintenance agent, "This Mac" local computers,
 * the Workspace domain, the CRM, bot credentials, public forms, the reply check, and the
 * computer workspace and run history additions.
 */
function manorRoutes(
  routerCtx: RouterContext,
  upstream: {
    computer: ReturnType<typeof computerRoutes>["computer"];
    runs: ReturnType<typeof contentRoutes>["runs"];
  },
) {
  const { deps, repos, authed, spaceAuthed } = routerCtx;
  const maintenance = createMaintenanceService(deps.prisma, deps.maintenance);
  const maintenanceAction = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof MaintenanceError)
        throw new ORPCError(error.code, { message: error.message });
      throw error;
    }
  };
  const wakeMaintenance = async (id: string) => {
    // The DB reconciler recovers a lost wake after broker or process failure.
    await deps.jobs.enqueue(maintenanceAdvanceJob(id)).catch(() => undefined);
  };
  const crm = createCrmRepos(deps.prisma);
  const workspace = createWorkspaceRepos(deps.prisma);
  const workspaceTeam = createWorkspaceTeam(deps.prisma);
  const workspaceActions = createWorkspaceActions({
    prisma: deps.prisma,
    secrets: deps.secrets,
    email: deps.email,
    propertyLedger: deps.propertyLedger,
    jobs: deps.jobs,
  });
  /** A refusal from a workspace write path becomes a BAD_REQUEST the client shows verbatim. */
  const workspaceAction = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof WorkspaceActionError) {
        throw new ORPCError("BAD_REQUEST", { message: error.message });
      }
      throw error;
    }
  };

  return {
    team: {
      list: authed.team.list.handler(({ context }) =>
        createTeamRepos(deps.prisma).list(context.actor),
      ),
      heartbeat: authed.team.heartbeat.handler(({ context }) =>
        createTeamRepos(deps.prisma).heartbeat(context.actor),
      ),
    },
    maintenance: {
      list: authed.maintenance.list.handler(({ context }) =>
        maintenanceAction(() => maintenance.list(context.actor.userId)),
      ),
      create: authed.maintenance.create.handler(({ context, input }) =>
        maintenanceAction(async () => {
          await requireMaintenanceOwner(deps.prisma, context.actor.userId);
          const evidence = input.runId
            ? await getRunDiagnostics(deps.prisma, context.actor, { runId: input.runId })
            : {};
          const job = await maintenance.create(
            context.actor.userId,
            input,
            JSON.parse(JSON.stringify(evidence)),
          );
          if (job.status === "queued") await wakeMaintenance(job.id);
          return job;
        }),
      ),
      approve: authed.maintenance.approve.handler(({ context, input }) =>
        maintenanceAction(async () => {
          const job = await maintenance.approve(context.actor.userId, input);
          await wakeMaintenance(job.id);
          return job;
        }),
      ),
      cancel: authed.maintenance.cancel.handler(({ context, input }) =>
        maintenanceAction(() => maintenance.cancel(context.actor.userId, input.id)),
      ),
    },
    localComputer: {
      session: spaceAuthed.localComputer.session.handler(async ({ context }) =>
        localComputerLiveSession(deps.prisma, context.actor),
      ),
      devices: spaceAuthed.localComputer.devices.handler(async ({ context }) =>
        listLocalDevices(deps.prisma, context.actor),
      ),
      register: spaceAuthed.localComputer.register.handler(async ({ context, input }) =>
        registerLocalDevice(deps.prisma, context.actor, input.name),
      ),
      revoke: spaceAuthed.localComputer.revoke.handler(async ({ context, input }) => {
        await revokeLocalDevice(deps.prisma, context.actor, input.deviceId);
        return { ok: true as const };
      }),
      stop: spaceAuthed.localComputer.stop.handler(async ({ context }) => {
        await stopLocalComputerSessions(deps.prisma, context.actor);
        return { ok: true as const };
      }),
    },
    workspace: {
      team: {
        list: spaceAuthed.workspace.team.list.handler(({ context }) =>
          workspaceTeam.list(context.actor),
        ),
        open: spaceAuthed.workspace.team.open.handler(({ context, input }) =>
          workspaceTeam.open(context.actor, input.botId),
        ),
      },
      status: authed.workspace.status.handler(async ({ context }) =>
        workspace.status(context.actor),
      ),
      access: authed.workspace.access.handler(({ context }) =>
        workspaceAccess(deps.prisma, context.actor.organizationId),
      ),
      overview: authed.workspace.overview.handler(async ({ context }) =>
        workspace.overview(context.actor),
      ),
      system: authed.workspace.system.handler(async ({ context }) =>
        workspace.system(context.actor),
      ),
      voice: {
        stats: authed.workspace.voice.stats.handler(async ({ context, input }) =>
          workspace.voiceStats(context.actor, input),
        ),
        calls: authed.workspace.voice.calls.handler(async ({ context, input }) =>
          workspace.voiceCalls(context.actor, input),
        ),
        call: authed.workspace.voice.call.handler(async ({ context, input }) =>
          workspace.voiceCall(context.actor, input.callId),
        ),
      },
      reports: {
        generate: authed.workspace.reports.generate.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.generateReport(context.actor, input)),
        ),
        testEmail: authed.workspace.reports.testEmail.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.testReportEmail(context.actor, input)),
        ),
        list: authed.workspace.reports.list.handler(async ({ context }) =>
          workspace.listReports(context.actor),
        ),
        get: authed.workspace.reports.get.handler(async ({ context, input }) =>
          workspace.getReport(context.actor, input.reportId),
        ),
        update: authed.workspace.reports.update.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.updateReport(context.actor, input)),
        ),
        approve: authed.workspace.reports.approve.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.approveReport(context.actor, input.reportId)),
        ),
        send: authed.workspace.reports.send.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.sendReport(context.actor, input)),
        ),
        remove: authed.workspace.reports.remove.handler(async ({ context, input }) => {
          await workspaceAction(() => workspaceActions.removeReport(context.actor, input.reportId));
          return { ok: true as const };
        }),
      },
      automations: {
        list: authed.workspace.automations.list.handler(async ({ context }) =>
          workspaceActions.listAutomations(context.actor),
        ),
        run: authed.workspace.automations.run.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.runAutomation(context.actor, input.key)),
        ),
        update: authed.workspace.automations.update.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.updateAutomation(context.actor, input)),
        ),
      },
      settings: {
        get: authed.workspace.settings.get.handler(async ({ context }) =>
          workspaceActions.getSettings(context.actor),
        ),
        update: authed.workspace.settings.update.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.updateSettings(context.actor, input)),
        ),
      },
      credentials: {
        list: authed.workspace.credentials.list.handler(async ({ context }) =>
          workspaceActions.listCredentials(context.actor),
        ),
        set: authed.workspace.credentials.set.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.setCredential(context.actor, input)),
        ),
        remove: authed.workspace.credentials.remove.handler(async ({ context, input }) => {
          await workspaceAction(() =>
            workspaceActions.removeCredential(context.actor, input.provider),
          );
          return { ok: true as const };
        }),
      },
      email: {
        performance: authed.workspace.email.performance.handler(async ({ context, input }) =>
          workspace.emailPerformance(context.actor, input),
        ),
        campaign: authed.workspace.email.campaign.handler(async ({ context, input }) =>
          workspace.emailCampaign(context.actor, input.sourceCampaignId),
        ),
      },
      social: {
        snapshot: authed.workspace.social.snapshot.handler(async ({ context, input }) =>
          workspace.socialSnapshot(context.actor, input),
        ),
      },
      leasing: {
        snapshot: authed.workspace.leasing.snapshot.handler(async ({ context }) =>
          workspace.leasingSnapshot(context.actor),
        ),
        rentals: authed.workspace.leasing.rentals.handler(async ({ context, input }) =>
          workspace.availableRentals(context.actor, input),
        ),
      },
      utilities: {
        overview: authed.workspace.utilities.overview.handler(async ({ context }) =>
          workspace.utilitiesOverview(context.actor),
        ),
        recordCityBill: authed.workspace.utilities.recordCityBill.handler(
          async ({ context, input }) =>
            workspaceAction(() => workspaceActions.recordCityBill(context.actor, input)),
        ),
        property: {
          save: authed.workspace.utilities.property.save.handler(async ({ context, input }) =>
            workspaceAction(() => workspaceActions.saveUtilityProperty(context.actor, input)),
          ),
          archive: authed.workspace.utilities.property.archive.handler(async ({ context, input }) =>
            workspaceAction(() => workspaceActions.archiveUtilityProperty(context.actor, input)),
          ),
        },
        archiveBills: authed.workspace.utilities.archiveBills.handler(async ({ context, input }) =>
          workspaceAction(() => workspaceActions.archiveWaterBills(context.actor, input)),
        ),
        syncFromCrm: authed.workspace.utilities.syncFromCrm.handler(async ({ context }) =>
          workspaceAction(() => workspaceActions.syncFromCrm(context.actor)),
        ),
        charge: {
          save: authed.workspace.utilities.charge.save.handler(async ({ context, input }) =>
            workspaceAction(() => workspaceActions.saveCharge(context.actor, input)),
          ),
          skip: authed.workspace.utilities.charge.skip.handler(async ({ context, input }) =>
            workspaceAction(() => workspaceActions.skipCharge(context.actor, input)),
          ),
          post: authed.workspace.utilities.charge.post.handler(async ({ context, input }) =>
            workspaceAction(() => workspaceActions.postCharge(context.actor, input)),
          ),
        },
        postAllPending: authed.workspace.utilities.postAllPending.handler(
          async ({ context, input }) =>
            workspaceAction(() => workspaceActions.postAllPending(context.actor, input)),
        ),
      },
      activities: {
        list: authed.workspace.activities.list.handler(async ({ context, input }) =>
          workspace.listActivities(context.actor, input),
        ),
      },
      skills: {
        list: authed.workspace.skills.list.handler(async ({ context }) =>
          workspace.listSkills(context.actor),
        ),
        get: authed.workspace.skills.get.handler(async ({ context, input }) =>
          workspace.getSkill(context.actor, input),
        ),
      },
      context: {
        list: authed.workspace.context.list.handler(async ({ context }) =>
          workspace.listContext(context.actor),
        ),
      },
    },
    crm: {
      overview: authed.crm.overview.handler(async ({ context }) => crm.overview(context.actor)),
      contacts: {
        create: authed.crm.contacts.create.handler(async ({ context, input }) => {
          const contact = await crm.createContact(context.actor, input);
          await deps.crmEvent?.(
            context.actor.organizationId,
            "contact.created",
            contact.id,
            contact,
          );
          return contact;
        }),
        update: authed.crm.contacts.update.handler(async ({ context, input }) => {
          const contact = await crm.updateContact(context.actor, input);
          await deps.crmEvent?.(
            context.actor.organizationId,
            "contact.updated",
            contact.id,
            contact,
          );
          return contact;
        }),
        delete: authed.crm.contacts.delete.handler(async ({ context, input }) => {
          await crm.deleteContact(context.actor, input.contactId);
          return { ok: true as const };
        }),
      },
      tags: {
        create: authed.crm.tags.create.handler(async ({ context, input }) =>
          crm.createTag(context.actor, input),
        ),
      },
      pipelines: {
        create: authed.crm.pipelines.create.handler(async ({ context, input }) =>
          crm.createPipeline(context.actor, input),
        ),
        seed: authed.crm.pipelines.seed.handler(async ({ context }) =>
          crm.seedDefaultPipeline(context.actor),
        ),
        delete: authed.crm.pipelines.delete.handler(async ({ context, input }) => {
          await crm.deletePipeline(context.actor, input.pipelineId);
          return { ok: true as const };
        }),
      },
      deals: {
        create: authed.crm.deals.create.handler(async ({ context, input }) => {
          const deal = await crm.createDeal(context.actor, input);
          await deps.crmEvent?.(context.actor.organizationId, "deal.created", deal.id, deal);
          return deal;
        }),
        update: authed.crm.deals.update.handler(async ({ context, input }) => {
          const deal = await crm.updateDeal(context.actor, input);
          await deps.crmEvent?.(context.actor.organizationId, "deal.updated", deal.id, deal);
          return deal;
        }),
        move: authed.crm.deals.move.handler(async ({ context, input }) => {
          const deal = await crm.moveDeal(context.actor, input.dealId, input.stageId);
          await deps.crmEvent?.(context.actor.organizationId, "deal.stage_changed", deal.id, deal);
          return deal;
        }),
        delete: authed.crm.deals.delete.handler(async ({ context, input }) => {
          await crm.deleteDeal(context.actor, input.dealId);
          return { ok: true as const };
        }),
      },
      modules: {
        list: authed.crm.modules.list.handler(async ({ context }) =>
          crm.listModules(context.actor),
        ),
        create: authed.crm.modules.create.handler(async ({ context, input }) =>
          crm.createModule(context.actor, input),
        ),
        update: authed.crm.modules.update.handler(async ({ context, input }) =>
          crm.updateModule(context.actor, input),
        ),
        delete: authed.crm.modules.delete.handler(async ({ context, input }) => {
          await crm.deleteModule(context.actor, input.moduleId);
          return { ok: true as const };
        }),
        fields: {
          create: authed.crm.modules.fields.create.handler(async ({ context, input }) =>
            crm.createModuleField(context.actor, input),
          ),
          update: authed.crm.modules.fields.update.handler(async ({ context, input }) =>
            crm.updateModuleField(context.actor, input),
          ),
          delete: authed.crm.modules.fields.delete.handler(async ({ context, input }) =>
            crm.deleteModuleField(context.actor, input),
          ),
        },
        records: {
          list: authed.crm.modules.records.list.handler(async ({ context, input }) =>
            crm.listModuleRecords(context.actor, input),
          ),
          create: authed.crm.modules.records.create.handler(async ({ context, input }) => {
            const record = await moduleRecordWrite(() =>
              crm.createModuleRecord(context.actor, input),
            );
            await deps.crmEvent?.(
              context.actor.organizationId,
              "record.created",
              record.id,
              record,
            );
            return record;
          }),
          update: authed.crm.modules.records.update.handler(async ({ context, input }) => {
            const record = await moduleRecordWrite(() =>
              crm.updateModuleRecord(context.actor, input),
            );
            await deps.crmEvent?.(
              context.actor.organizationId,
              "record.updated",
              record.id,
              record,
            );
            return record;
          }),
          delete: authed.crm.modules.records.delete.handler(async ({ context, input }) => {
            await crm.deleteModuleRecord(context.actor, input.recordId);
            return { ok: true as const };
          }),
        },
      },
    },
    computer: {
      ...upstream.computer,
      workspace: spaceAuthed.computer.workspace.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        const computer = bot.computer;
        if (!computer) throw new IsolationError();
        const team = computer.scope === "team";
        if (
          !team &&
          (input.location === "shared" ||
            (input.operation.action === "move" && input.operation.destinationLocation === "shared"))
        ) {
          throw new ORPCError("BAD_REQUEST", { message: "Shared files belong to a Team Computer" });
        }
        if (computer.state !== "running" || !computer.providerRef) {
          throw new ORPCError("BAD_REQUEST", { message: "Wake the computer to manage its files" });
        }
        const providerRef = computer.providerRef;
        const base = (location: "bot" | "shared") =>
          team ? (location === "shared" ? "shared" : `bots/${bot.id}`) : "";
        const mutation = workspaceOperationMutates(input.operation);
        const operationId = `workspace-files:${randomUUID()}`;
        const ctx = computerContext(context.actor, bot.id, operationId);
        // Manor: a file change holds the computer's `workspace-files:<computerId>` lease (the shared
        // `leases` table, since upstream dropped the computer's execution columns), so a run cannot
        // start on it meanwhile and two changes never overlap.
        const manage = async () => {
          if (mutation) {
            const activeRun = await deps.prisma.run.findFirst({
              where: { bot: { computerId: computer.id }, status: { in: [...ACTIVE_RUN_STATUSES] } },
              select: { id: true },
            });
            const lease = await deps.prisma.computerExecutionLease.findFirst({
              where: { computerId: computer.id, expiresAt: { gt: new Date() } },
              select: { id: true },
            });
            if (activeRun || lease)
              throw new ORPCError("CONFLICT", {
                message:
                  "A bot is working on this computer. Wait for it to finish before changing files.",
              });
          }
          await deps.prisma.computer.updateMany({
            where: { id: computer.id, state: "running" },
            data: { updatedAt: new Date() },
          });
          await touchRunningComputer(deps, { ...computer, providerRef });
          return manageWorkspaceFiles(
            deps.sandbox,
            toComputerRef(computer),
            {
              base: base(input.location),
              ...(input.operation.action === "move"
                ? { destinationBase: base(input.operation.destinationLocation) }
                : {}),
              operation: input.operation,
            },
            ctx,
          );
        };
        try {
          return mutation
            ? await withLease(
                deps.prisma,
                workspaceFilesLeaseKey(computer.id),
                { ttlMs: 120_000, signal: context.signal },
                manage,
              )
            : await manage();
        } catch (error) {
          if (error instanceof LeaseHeldError)
            throw new ORPCError("CONFLICT", {
              message: "The computer is busy. Try again when it finishes.",
            });
          if (error instanceof WorkspaceFileError)
            throw new ORPCError(error.code, { message: error.message });
          throw error;
        } finally {
          scheduleComputerSleep(deps.jobs, computer.id);
        }
      }),
      writeFile: spaceAuthed.computer.writeFile.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.computer) throw new IsolationError();
        const activeRun = await deps.prisma.run.findFirst({
          where: { botId: bot.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
          select: { id: true },
        });
        if (activeRun) {
          throw new ORPCError("CONFLICT", {
            message: "The bot is working. Wait for the run to finish before editing files.",
          });
        }
        const computerMode = parseComputerMode(bot.computer.scope);
        const ctx = computerContext(context.actor, bot.id, "write");
        const storedPath = resolveBotWorkspacePath(computerMode, bot.id, input.path);
        if (bot.computer.state === "running" && bot.computer.providerRef) {
          await deps.prisma.computer.updateMany({
            where: { id: bot.computer.id, state: "running" },
            data: { updatedAt: new Date() },
          });
          scheduleComputerSleep(deps.jobs, bot.computer.id);
          await deps.sandbox.writeFile(
            toComputerRef(bot.computer),
            { path: storedPath, content: Buffer.from(input.content, "utf8") },
            ctx,
          );
        } else {
          await deps.home.writeFile(bot.computer.homeKey, storedPath, input.content, ctx);
        }
        return { path: input.path };
      }),
      changes: spaceAuthed.computer.changes.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.computer) throw new IsolationError();
        if (bot.computer.state !== "running" || !bot.computer.providerRef) {
          return { available: false, repos: [] };
        }
        const computerMode = parseComputerMode(bot.computer.scope);
        const ctx = computerContext(context.actor, bot.id, "changes");
        const ref = toComputerRef(bot.computer);
        const root = resolveBotWorkspaceCwd(computerMode, bot.id, undefined);
        const found = await runInComputer(deps.sandbox, ref, findGitRepositoriesArgv(), root, ctx);
        const collected: WorkspaceRepo[] = [];
        for (const repoPath of parseRepositoryList(found.stdout)) {
          const cwd = repoPath ? path.posix.join(root ?? "", repoPath) : root;
          const status = await runInComputer(deps.sandbox, ref, gitStatusArgv(), cwd, ctx);
          if (status.code !== 0) continue;
          collected.push({ path: repoPath, files: parseGitStatus(status.stdout) });
        }
        return { available: true, repos: collected };
      }),
      diff: spaceAuthed.computer.diff.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.computer) throw new IsolationError();
        if (
          !isSafeRepoRelativePath(input.path) ||
          (input.repo !== "" && !isSafeRepoRelativePath(input.repo))
        ) {
          throw new ORPCError("BAD_REQUEST", { message: "invalid path" });
        }
        if (bot.computer.state !== "running" || !bot.computer.providerRef) {
          throw new ORPCError("BAD_REQUEST", { message: "The computer is asleep" });
        }
        const computerMode = parseComputerMode(bot.computer.scope);
        const ctx = computerContext(context.actor, bot.id, "diff");
        const ref = toComputerRef(bot.computer);
        const root = resolveBotWorkspaceCwd(computerMode, bot.id, undefined);
        const cwd = input.repo ? path.posix.join(root ?? "", input.repo) : root;
        const status = await runInComputer(
          deps.sandbox,
          ref,
          [...gitStatusArgv(), "--", input.path],
          cwd,
          ctx,
        );
        const change = parseGitStatus(status.stdout).find((item) => item.path === input.path);
        const diff = await runInComputer(
          deps.sandbox,
          ref,
          gitDiffArgv(change?.status ?? "modified", input.path),
          cwd,
          ctx,
        );
        return truncateDiff(diff.stdout);
      }),
      upload: spaceAuthed.computer.upload.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.computer) throw new IsolationError();
        const computerMode = parseComputerMode(bot.computer.scope);
        const ctx = computerContext(context.actor, bot.id, "upload");
        const filename = input.filename.replace(/[/\\]/g, "_").replace(/^\.+/, "_");
        let bytes: Uint8Array;
        try {
          bytes = Uint8Array.from(Buffer.from(input.dataBase64, "base64"));
        } catch {
          throw new ORPCError("BAD_REQUEST", { message: "invalid file data" });
        }
        const uploadPath = `uploads/${filename}`;
        const storedPath = resolveBotWorkspacePath(computerMode, bot.id, uploadPath);
        const computer = await provisionComputer(deps, bot.computer.id, ctx);
        scheduleComputerSleep(deps.jobs, bot.computer.id);
        await deps.sandbox.writeFile(computer, { path: storedPath, content: bytes }, ctx);
        return { path: uploadPath };
      }),
      previewUrl: spaceAuthed.computer.previewUrl.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        const computer = bot.computer;
        if (!computer?.providerRef || computer.state !== "running" || computer.kind !== "docker") {
          return { url: null };
        }
        // The app port lives on the same host as the screen; reuse the screen
        // session to learn that host instead of teaching providers a new call.
        const session = await deps.sandbox
          .connectScreen(
            toComputerRef(computer),
            { view: "stream", interactive: false },
            await computerScreenContext(deps.prisma, context.actor, computer.id, bot.id, "preview"),
          )
          .catch(() => null);
        if (!session?.url) return { url: null };
        let hostname: string;
        try {
          hostname = new URL(session.url).hostname;
        } catch {
          return { url: null };
        }
        if (!hostname) return { url: null };
        scheduleComputerSleep(deps.jobs, computer.id);
        return {
          url: addPreviewProxyCapability(
            { hostname, port: input.port },
            deps.env.screenProxySecret,
            deps.env.webOrigin,
            input.path ?? "/",
          ),
        };
      }),
    },
    credentials: {
      list: spaceAuthed.credentials.list.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        const rows = await deps.prisma.botCredential.findMany({
          where: { botId: input.botId, spaceId: context.actor.spaceId },
          orderBy: { createdAt: "asc" },
        });
        return rows.map(botCredentialDto);
      }),
      create: spaceAuthed.credentials.create.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        const payload = serializeBotCredentialSecret({
          password: input.password,
          totp: input.totpSecret,
        });
        const stored = payload
          ? await deps.secrets.put(
              payload,
              computerContext(context.actor, input.botId, "credentials.create"),
            )
          : null;
        const row = await deps.prisma.$transaction(async (tx) => {
          if (stored) {
            await tx.secret.create({
              data: {
                id: stored.id,
                userId: context.actor.userId,
                spaceId: context.actor.spaceId,
                kind: BOT_CREDENTIAL_SECRET_KIND,
                ciphertext: stored.ciphertext,
              },
            });
          }
          return tx.botCredential.create({
            data: {
              spaceId: context.actor.spaceId,
              botId: input.botId,
              userId: context.actor.userId,
              label: input.label,
              site: input.site,
              username: input.username,
              notes: input.notes,
              hasPassword: Boolean(input.password),
              hasTotp: Boolean(input.totpSecret),
              secretId: stored?.id,
            },
          });
        });
        return botCredentialDto(row);
      }),
      update: spaceAuthed.credentials.update.handler(async ({ context, input }) => {
        const existing = await deps.prisma.botCredential.findFirst({
          where: { id: input.credentialId, spaceId: context.actor.spaceId },
        });
        if (!existing) throw new IsolationError();
        const secretChanged = input.password !== undefined || input.totpSecret !== undefined;
        const current = secretChanged
          ? await loadBotCredentialSecret(
              deps.prisma,
              deps.secrets,
              { spaceId: context.actor.spaceId, userId: existing.userId },
              existing.secretId,
            )
          : {};
        const nextSecret = secretChanged
          ? {
              password: input.password ?? current.password,
              totp: input.totpSecret ?? current.totp,
            }
          : null;
        const payload = nextSecret ? serializeBotCredentialSecret(nextSecret) : null;
        const stored = payload
          ? await deps.secrets.put(
              payload,
              computerContext(context.actor, existing.botId, "credentials.update"),
            )
          : null;
        const row = await deps.prisma.$transaction(async (tx) => {
          if (stored) {
            await tx.secret.create({
              data: {
                id: stored.id,
                userId: context.actor.userId,
                spaceId: context.actor.spaceId,
                kind: BOT_CREDENTIAL_SECRET_KIND,
                ciphertext: stored.ciphertext,
              },
            });
          }
          const updated = await tx.botCredential.update({
            where: { id: existing.id },
            data: {
              label: input.label,
              site: input.site,
              username: input.username,
              notes: input.notes,
              ...(secretChanged
                ? {
                    hasPassword: Boolean(nextSecret?.password),
                    hasTotp: Boolean(nextSecret?.totp),
                    secretId: stored?.id ?? null,
                  }
                : {}),
            },
          });
          if (secretChanged && existing.secretId) {
            await tx.secret.deleteMany({
              where: { id: existing.secretId, spaceId: context.actor.spaceId },
            });
          }
          return updated;
        });
        return botCredentialDto(row);
      }),
      remove: spaceAuthed.credentials.remove.handler(async ({ context, input }) => {
        const existing = await deps.prisma.botCredential.findFirst({
          where: { id: input.credentialId, spaceId: context.actor.spaceId },
          select: { id: true, secretId: true },
        });
        if (!existing) throw new IsolationError();
        // Interactive: row-level security rejects a batch transaction in the caller's context.
        await deps.prisma.$transaction(async (tx) => {
          await tx.botCredential.delete({ where: { id: existing.id } });
          if (existing.secretId)
            await tx.secret.deleteMany({
              where: { id: existing.secretId, spaceId: context.actor.spaceId },
            });
        });
        return { ok: true as const };
      }),
    },
    publicForms: {
      list: authed.publicForms.list.handler(async ({ context }) => {
        if (!(await isOrganizationOwner(deps.prisma, context.actor))) {
          return { canManage: false, forms: [] };
        }
        const rows = await deps.prisma.publicForm.findMany({
          where: { organizationId: context.actor.organizationId },
          orderBy: { createdAt: "asc" },
        });
        return { canManage: true, forms: rows.map(publicFormDto) };
      }),
      save: authed.publicForms.save.handler(async ({ context, input }) => {
        await requireOrganizationOwner(deps.prisma, context.actor);
        const { id, ...fields } = input;
        const data = {
          ...fields,
          eventStartsAt: fields.eventStartsAt ? new Date(fields.eventStartsAt) : null,
        };
        const taken = await deps.prisma.publicForm.findUnique({
          where: { slug: fields.slug },
          select: { id: true },
        });
        if (taken && taken.id !== id) {
          throw new ORPCError("CONFLICT", { message: "That form address is already in use." });
        }
        if (id) {
          const owned = await deps.prisma.publicForm.updateMany({
            where: { id, organizationId: context.actor.organizationId },
            data,
          });
          if (owned.count === 0) throw new ORPCError("NOT_FOUND");
          return publicFormDto(await deps.prisma.publicForm.findUniqueOrThrow({ where: { id } }));
        }
        return publicFormDto(
          await deps.prisma.publicForm.create({
            data: { ...data, organizationId: context.actor.organizationId },
          }),
        );
      }),
      remove: authed.publicForms.remove.handler(async ({ context, input }) => {
        await requireOrganizationOwner(deps.prisma, context.actor);
        const removed = await deps.prisma.publicForm.deleteMany({
          where: { id: input.id, organizationId: context.actor.organizationId },
        });
        if (removed.count === 0) throw new ORPCError("NOT_FOUND");
        return { ok: true as const };
      }),
    },
    verification: {
      summary: spaceAuthed.verification.summary.handler(async ({ context, input }) => {
        const { rows, truncated } = await loadVerificationRows(deps, context.actor, input);
        return {
          engines: Object.entries(VERIFICATION_ENGINE_LABELS).map(([id, label]) => ({ id, label })),
          truncated,
          ...summarizeVerification(rows),
        };
      }),
      report: spaceAuthed.verification.report.handler(async ({ context, input }) => {
        const { rows, truncated } = await loadVerificationRows(deps, context.actor, input);
        const now = new Date().toISOString();
        const filename = `checker-comparison-${now.slice(0, 10)}`;
        if (input.format === "csv") {
          return {
            filename: `${filename}.csv`,
            mimeType: "text/csv",
            content: verificationReportCsv(rows),
          };
        }
        const botName = input.botId
          ? (await repos.getBot(context.actor, input.botId)).name
          : undefined;
        return {
          filename: `${filename}.md`,
          mimeType: "text/markdown",
          content: verificationReportMarkdown(summarizeVerification(rows), {
            generatedAt: `${now.slice(0, 16).replace("T", " ")} UTC`,
            days: input.days,
            botName,
            labels: VERIFICATION_ENGINE_LABELS,
            truncated,
          }),
        };
      }),
    },
    runs: {
      ...upstream.runs,
      history: spaceAuthed.runs.history.handler(({ context, input }) =>
        listBotRunHistory(deps.prisma, context.actor, input.botId),
      ),
      diagnostics: spaceAuthed.runs.diagnostics.handler(({ context, input }) =>
        getRunDiagnostics(deps.prisma, context.actor, input),
      ),
    },
  };
}

function botCredentialDto(row: {
  id: string;
  botId: string;
  label: string;
  site: string;
  username: string;
  notes: string;
  hasPassword: boolean;
  hasTotp: boolean;
  secretId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    botId: row.botId,
    label: row.label,
    site: row.site,
    username: row.username,
    notes: row.notes,
    hasPassword: row.hasPassword,
    hasTotp: row.hasTotp,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function isOrganizationOwner(prisma: RouterDeps["prisma"], actor: Actor) {
  const member = await prisma.member.findFirst({
    where: { organizationId: actor.organizationId, userId: actor.userId },
    select: { role: true },
  });
  return Boolean(member?.role.split(",").includes("owner"));
}

async function requireOrganizationOwner(prisma: RouterDeps["prisma"], actor: Actor) {
  if (!(await isOrganizationOwner(prisma, actor))) {
    throw new ORPCError("FORBIDDEN", { message: "Only organization owners can manage forms." });
  }
}

function publicFormDto(row: {
  id: string;
  slug: string;
  kind: string;
  title: string;
  enabled: boolean;
  crmTag: string;
  allowedOrigins: string[];
  message: string | null;
  notifyEmail: string | null;
  senderName: string | null;
  signature: string | null;
  eventStartsAt: Date | null;
  eventMinutes: number | null;
  eventTimeZone: string | null;
  joinUrl: string | null;
  bookingUrl: string | null;
  updatedAt: Date;
}) {
  return {
    ...row,
    kind: row.kind === "scorecard" ? ("scorecard" as const) : ("event" as const),
    eventStartsAt: row.eventStartsAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const MAX_VERIFICATION_ROWS = 5_000;

const verificationRowInclude = {
  run: {
    select: {
      botId: true,
      threadId: true,
      bot: { select: { name: true } },
      task: { select: { prompt: true } },
    },
  },
  effect: { select: { status: true } },
} as const;

/**
 * This person's most recent checks in the window, joined with the bot, request, and action
 * outcome. Engines log separately, so a cap can cut a pair in half; missing partners are
 * loaded, and checks that started before the window are left out whole.
 */
async function loadVerificationRows(
  deps: RouterDeps,
  actor: Actor,
  input: { days: number; botId?: string },
): Promise<{ rows: VerificationCheckInput[]; truncated: boolean }> {
  const owner = { spaceId: actor.spaceId, userId: actor.userId };
  const since = new Date(Date.now() - input.days * 86_400_000);
  const recent = await deps.prisma.verificationCheck.findMany({
    where: {
      ...owner,
      createdAt: { gte: since },
      ...(input.botId ? { run: { botId: input.botId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: MAX_VERIFICATION_ROWS + 1,
    include: verificationRowInclude,
  });
  const truncated = recent.length > MAX_VERIFICATION_ROWS;
  const kept = recent.slice(0, MAX_VERIFICATION_ROWS);
  const effectIds = [...new Set(kept.flatMap((row) => (row.effectId ? [row.effectId] : [])))];
  const answerRunIds = [
    ...new Set(kept.filter((row) => row.checkpoint === "answer").map((row) => row.runId)),
  ];
  const partners = await deps.prisma.verificationCheck.findMany({
    where: {
      ...owner,
      OR: [{ effectId: { in: effectIds } }, { checkpoint: "answer", runId: { in: answerRunIds } }],
    },
    include: verificationRowInclude,
  });
  const byId = new Map([...kept, ...partners].map((row) => [row.id, row]));
  const loaded = [...byId.values()].map((row) => ({
    createdAt: row.createdAt.toISOString(),
    checkpoint: row.checkpoint,
    subject: row.subject,
    engine: row.engine,
    role: row.role,
    decision: row.decision,
    reason: row.reason,
    probability: row.probability,
    confidence: row.confidence,
    details: row.details,
    model: row.model,
    latencyMs: row.latencyMs,
    costUsd: row.costUsd,
    runId: row.runId,
    effectId: row.effectId,
    effectStatus: row.effect?.status ?? null,
    botId: row.run.botId,
    botName: row.run.bot.name,
    threadId: row.run.threadId,
    task: row.run.task.prompt,
  }));
  return { rows: checksStartingSince(loaded, since.toISOString()), truncated };
}

async function computerScreenContext(
  prisma: PrismaClient,
  actor: Actor,
  computerId: string,
  botId: string,
  operationId: string,
): Promise<AdapterContext> {
  const context = computerContext(actor, botId, operationId);
  const lease = await prisma.computerExecutionLease.findUnique({
    where: { computerId_botId: { computerId, botId } },
    select: { runId: true, fence: true, expiresAt: true },
  });
  if (!lease || lease.expiresAt.getTime() <= Date.now()) return context;
  return { ...context, screenLeaseId: screenLeaseIdForRun(lease, lease.runId) };
}

/** Bad record values are a caller mistake, not a server fault. */
async function moduleRecordWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof CrmModuleValueError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
}

/** What the procedures read from the deployment's settings. */
export function routerEnv(env: AppEnv): RouterDeps["env"] {
  return {
    inboundEmailDomain: env.inboundEmail?.domain,
    deploymentLabs: env.deploymentLabs,
    deploymentVoice: env.deploymentVoice,
    phoneCallsEnabled: env.phoneCallsEnabled,
    phoneCallRingSeconds: env.phoneCallRingSeconds,
    navLinks: env.navLinks,
    adminEmails: env.adminEmails,
    maxUploadSizeBytes: env.maxUploadSizeBytes,
    maxAttachmentsPerMessage: env.maxAttachmentsPerMessage,
    agentRuntime: env.agentRuntime,
    defaultProvider: env.defaultProvider,
    defaultModel: env.defaultModel,
    teamChatJudgeProvider: env.teamChatJudgeProvider,
    teamChatJudgeModel: env.teamChatJudgeModel,
    deploymentModelConfigured: env.deploymentModelConfigured,
    deploymentModelHostCredentials: env.deploymentModelHostCredentials,
    webOrigin: env.webOrigin,
    privacyPolicyUrl: env.privacyPolicyUrl,
    screenProxySecret: env.screenProxySecret,
    invitationRecipientKey: createHmac("sha256", env.authSecret)
      .update("organization-invitation-recipient")
      .digest("hex"),
    sandboxProvider: env.sandboxProvider,
    gitSha: env.gitSha,
    integrationsCatalogUrl: env.integrationsCatalogUrl,
    mcpAllowPrivateEndpoint: env.mcpAllowPrivateEndpoint,
    desktopHostChoiceEnabled: Boolean(env.desktopStackToken),
    computerSettingsEnabled: env.computerSettingsEnabled,
    mcpStdioEnabled: env.mcpStdioEnabled,
    mcpStdioAllowedCommands: env.mcpStdioAllowedCommands,
  };
}
