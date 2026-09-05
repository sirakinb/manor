import { createHash } from "node:crypto";
import type { ConnectorTool, JobPublisher } from "@rakazo/adapter-kit";
import {
  workspaceToolDescriptions as descriptions,
  workspaceToolSchemas as schemas,
} from "@rakazo/contracts";
import {
  createWorkspaceRepos,
  ensureDefaultAutomations,
  IsolationError,
  listWorkspaceAutomations,
  type PrismaClient,
  type WorkspaceAgentOwner,
  workspaceForAgent,
} from "@rakazo/db";
import * as z from "zod";
import {
  requestWorkspaceAutomationRun,
  WorkspaceAutomationRequestError,
} from "./workspace-automation-request.js";

export const workspaceAgentTools: ConnectorTool[] = Object.entries(schemas).map(
  ([name, schema]) => ({
    name,
    description: descriptions[name as keyof typeof schemas],
    inputSchema: z.toJSONSchema(schema),
  }),
);
export const WORKSPACE_READ_ONLY_TOOL_NAMES = workspaceAgentTools
  .map((tool) => tool.name)
  .filter(
    (name) =>
      ![
        "workspace_run_automation",
        "workspace_log_activity",
        "workspace_set_context",
        "workspace_save_skill",
      ].includes(name),
  );

type WorkspaceToolOwner = WorkspaceAgentOwner &
  ({ botId: string; executionId: string } | { integrationId: string });

export async function executeWorkspaceTool(
  deps: { prisma: PrismaClient; jobs?: JobPublisher },
  owner: WorkspaceToolOwner,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown | undefined> {
  if (!Object.hasOwn(schemas, name)) return undefined;
  const schema = schemas[name as keyof typeof schemas];
  const parsed = schema.safeParse(args);
  if (!parsed.success)
    return {
      error: "Invalid workspace tool arguments.",
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    };
  try {
    const workspace = await workspaceForAgent(deps.prisma, {
      spaceId: owner.spaceId,
      userId: owner.userId,
    });
    if (!workspace) return { error: "No workspace is connected to this organization." };
    const actor = { organizationId: workspace.organizationId };
    const repos = createWorkspaceRepos(deps.prisma);
    const attribution =
      "integrationId" in owner ? `integration:${owner.integrationId}` : `bot:${owner.botId}`;
    switch (name) {
      case "workspace_get_context": {
        const { keys } = schemas.workspace_get_context.parse(args);
        return (await repos.listContext(actor)).filter(
          (entry) => !keys || keys.includes(entry.key),
        );
      }
      case "workspace_list_skills":
        return await repos.listSkills(actor);
      case "workspace_get_skill":
        return await repos.getSkill(actor, schemas.workspace_get_skill.parse(args));
      case "workspace_set_context":
      case "workspace_save_skill": {
        const member = await deps.prisma.member.findFirst({
          where: { organizationId: workspace.organizationId, userId: owner.userId },
        });
        if (!member?.role.split(",").some((role) => ["owner", "admin"].includes(role.trim())))
          return {
            error: "Only organization owners and admins can change shared knowledge.",
            code: "forbidden",
          };
        return await deps.prisma.$transaction(async (tx) => {
          // Serialize shared knowledge writes with a workspace row lock, including first creates.
          await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspace.id} FOR UPDATE`;
          if (name === "workspace_set_context") {
            const input = schemas.workspace_set_context.parse(args);
            const where = { workspaceId_key: { workspaceId: workspace.id, key: input.key } };
            const current = await tx.workspaceContext.findUnique({ where });
            if (current?.content === input.content) return current;
            if ((current?.updatedAt.toISOString() ?? null) !== input.expectedUpdatedAt)
              return {
                error: "Context changed. Read it again and reconcile before saving.",
                code: "conflict",
              };
            return tx.workspaceContext.upsert({
              where,
              create: {
                workspaceId: workspace.id,
                key: input.key,
                content: input.content,
                updatedBy: attribution,
              },
              update: { content: input.content, updatedBy: attribution },
            });
          }
          const input = schemas.workspace_save_skill.parse(args);
          const latest = await tx.workspaceSkill.findFirst({
            where: { workspaceId: workspace.id, name: input.name },
            orderBy: { version: "desc" },
          });
          if (
            latest?.version === input.expectedVersion + 1 &&
            latest.content === input.content &&
            latest.kind === input.kind &&
            latest.notes === input.notes
          )
            return latest;
          if ((latest?.version ?? 0) !== input.expectedVersion)
            return {
              error: "Skill changed. Read its latest version and reconcile before saving.",
              code: "conflict",
            };
          return tx.workspaceSkill.create({
            data: {
              workspaceId: workspace.id,
              name: input.name,
              content: input.content,
              kind: input.kind,
              notes: input.notes,
              version: input.expectedVersion + 1,
              createdBy: attribution,
            },
          });
        });
      }
      case "workspace_overview":
        return await repos.overview(actor);
      case "workspace_voice_stats":
        return await repos.voiceStats(actor, schemas.workspace_voice_stats.parse(args));
      case "workspace_voice_calls":
        return await repos.voiceCalls(actor, schemas.workspace_voice_calls.parse(args));
      case "workspace_voice_call":
        return await repos.voiceCall(actor, schemas.workspace_voice_call.parse(args).callId);
      case "workspace_reports":
        return await repos.listReports(actor);
      case "workspace_report":
        return await repos.getReport(actor, schemas.workspace_report.parse(args).reportId);
      case "workspace_email":
        return await repos.emailPerformance(actor, schemas.workspace_email.parse(args));
      case "workspace_email_campaign":
        return await repos.emailCampaign(
          actor,
          schemas.workspace_email_campaign.parse(args).sourceCampaignId,
        );
      case "workspace_social":
        return await repos.socialSnapshot(actor, schemas.workspace_social.parse(args));
      case "workspace_leasing":
        return await repos.leasingSnapshot(actor);
      case "workspace_rentals":
        return await repos.availableRentals(actor, schemas.workspace_rentals.parse(args));
      case "workspace_utilities":
        return await repos.utilitiesOverview(actor);
      case "workspace_system":
        return await repos.system(actor);
      case "workspace_activities":
        return await repos.listActivities(actor, schemas.workspace_activities.parse(args));
      case "workspace_automations":
        await ensureDefaultAutomations(deps.prisma, workspace, new Date());
        return await listWorkspaceAutomations(deps.prisma, workspace.id, new Date());
      case "workspace_run_automation":
        if ("integrationId" in owner)
          return { error: "External automation execution is not enabled.", code: "forbidden" };
        return await requestWorkspaceAutomationRun(
          deps.prisma,
          deps.jobs,
          { ...actor, userId: owner.userId },
          schemas.workspace_run_automation.parse(args).key,
        );
      case "workspace_log_activity": {
        const bot =
          "botId" in owner
            ? await deps.prisma.bot.findFirst({
                where: {
                  id: owner.botId,
                  spaceId: owner.spaceId,
                  userId: owner.userId,
                  archivedAt: null,
                },
                select: { id: true, name: true },
              })
            : null;
        const integration =
          "integrationId" in owner
            ? await deps.prisma.integrationCredential.findFirst({
                where: {
                  id: owner.integrationId,
                  spaceId: owner.spaceId,
                  createdByUserId: owner.userId,
                  revokedAt: null,
                },
              })
            : null;
        if (!bot && !integration) throw new IsolationError();
        const data = schemas.workspace_log_activity.parse(args);
        if (integration && !data.idempotencyKey)
          return {
            error: "idempotencyKey is required for external activity writes.",
            code: "invalid",
          };
        const idempotencyKey =
          "executionId" in owner
            ? owner.executionId
            : createHash("sha256").update(`${attribution}:${data.idempotencyKey}`).digest("hex");
        const requestHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
        const row = await deps.prisma.workspaceActivity.upsert({
          where: {
            workspaceId_idempotencyKey: {
              workspaceId: workspace.id,
              idempotencyKey,
            },
          },
          create: {
            channel: data.channel,
            title: data.title,
            summary: data.summary,
            status: data.status,
            workspaceId: workspace.id,
            kind: "agent_note",
            actor: bot?.name ?? integration!.name,
            verification: "pending",
            idempotencyKey,
            payload: {
              ...(bot
                ? { botId: bot.id, source: "native" }
                : { integrationId: integration!.id, source: "external" }),
              requestHash,
              evidence: data.evidence ?? {},
            },
          },
          update: {},
        });
        const payload = row.payload as { requestHash?: string } | null;
        if (integration && payload?.requestHash !== requestHash)
          return {
            error: "Idempotency key already used for different activity.",
            code: "conflict",
          };
        return { activityId: row.id, verification: row.verification };
      }
    }
  } catch (error) {
    if (error instanceof IsolationError)
      return { error: "Workspace record not found or access denied." };
    if (error instanceof WorkspaceAutomationRequestError) return { error: error.message };
    return { error: "Workspace operation failed. Try again." };
  }
}
