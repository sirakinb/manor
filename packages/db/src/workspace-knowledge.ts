import { createHash } from "node:crypto";
import { buildSkillMd, parseSkillMd } from "@rakazo/core";
import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

export type WorkspaceAgentOwner = { spaceId: string; userId: string };

/** Resolve from current membership, never from model-supplied organization ids. */
export async function workspaceForAgent(prisma: PrismaClient, owner: WorkspaceAgentOwner) {
  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: owner.spaceId, userId: owner.userId } },
    select: { organizationId: true },
  });
  if (!member) throw new IsolationError();
  return prisma.workspace.findUnique({ where: { organizationId: member.organizationId } });
}

function suffix(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

/** Atomic, once per member's space; native edits and deletions remain authoritative. */
export async function importWorkspaceKnowledge(prisma: PrismaClient, owner: WorkspaceAgentOwner) {
  owner = { spaceId: owner.spaceId, userId: owner.userId };
  const workspace = await workspaceForAgent(prisma, owner);
  if (!workspace) return null;
  const receipt = { workspaceId: workspace.id, ...owner };
  if (
    await prisma.workspaceKnowledgeImport.findUnique({
      where: { workspaceId_spaceId_userId: receipt },
    })
  )
    return workspace;

  await prisma.$transaction(
    async (tx) => {
      // The unique receipt serializes concurrent first visits; rollback includes all copies.
      const claimed = await tx.workspaceKnowledgeImport.createMany({
        data: [receipt],
        skipDuplicates: true,
      });
      if (!claimed.count) return;
      const skills = await tx.workspaceSkill.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ name: "asc" }, { version: "desc" }],
        distinct: ["name"],
      });
      for (const skill of skills) {
        const parsed = parseSkillMd(skill.content);
        const baseName = `workspace-${skill.name.trim().slice(0, 70)}`;
        const clash = await tx.agentSkill.findFirst({
          where: { ...owner, name: { equals: baseName, mode: "insensitive" } },
          select: { id: true },
        });
        const name = clash ? `${baseName.slice(0, 69)}-${suffix(skill.id)}` : baseName;
        const description = (skill.notes?.trim() || `Workspace playbook: ${skill.name}`).slice(
          0,
          2000,
        );
        const content = buildSkillMd({
          name,
          description,
          body: [
            "# Using this imported playbook",
            "Use current workspace tools and connected integrations. The original playbook below is historical reference: its hosts, credentials, local paths, commands and schedules may belong to the old system. Do not execute those legacy commands or change that system.",
            "Start with workspace_overview and check freshness. Use workspace_rentals instead of get_available_rentals. Use workspace_log_activity with channel, title and summary instead of log_activity; a note cannot approve an action. Use workspace_automations to find supported refreshes and workspace_run_automation to request one under normal approval rules.",
            "Read current space memory for context. Only use other actions when a current connected tool explicitly supports them. In particular, legacy Retell update tools are not part of this migration; explain that capability is unavailable if no current integration provides it. Do not infer access from the original playbook. Report preparation never implies approval or sending.",
            "## Original playbook",
            "error" in parsed ? skill.content : parsed.body,
          ].join("\n\n"),
        });
        if (content.length > 100_000)
          throw new Error("Workspace playbook exceeds the native skill limit.");
        await tx.agentSkill.create({
          data: { ...owner, name, description, content, source: "user" },
        });
      }
      const entries = await tx.workspaceContext.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { key: "asc" },
      });
      for (const entry of entries) {
        const path = `workspace/${encodeURIComponent(entry.key)}.md`;
        // A member's existing memory takes precedence over an imported source.
        const existing = await tx.memoryDocument.findFirst({
          where: { ...owner, scope: "user", botId: null, path },
        });
        if (existing) continue;
        await tx.memoryDocument.create({
          data: {
            ...owner,
            scope: "user",
            path,
            content: entry.content,
            revisions: { create: { revision: 1, content: entry.content } },
          },
        });
      }
    },
    { timeout: 30_000 },
  );
  return workspace;
}
