import { randomUUID } from "node:crypto";
import type { JobPublisher } from "@rakazo/adapter-kit";
import { parseSkillMd } from "@rakazo/core";
import {
  createDb,
  importWorkspaceKnowledge,
  type PrismaClient,
  workspaceForAgent,
} from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeWorkspaceTool } from "./workspace-tools.js";

const suite =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;
suite("workspace agents and knowledge (PostgreSQL)", () => {
  const stamp = randomUUID();
  const org = `wa-org-${stamp}`;
  const otherOrg = `wa-other-${stamp}`;
  const spaceId = `wa-space-${stamp}`;
  const otherSpace = `wa-space-other-${stamp}`;
  const userA = `wa-user-a-${stamp}`;
  const userB = `wa-user-b-${stamp}`;
  const userC = `wa-user-c-${stamp}`;
  const owner = { spaceId, userId: userA };
  const peer = { spaceId, userId: userB };
  let workspaceId: string;
  let botId: string;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as JobPublisher;
  beforeAll(async () => {
    const db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
    for (const id of [org, otherOrg])
      await prisma.organization.create({
        data: { id, name: "Sample operations", slug: id, createdAt: new Date() },
      });
    for (const [id, organizationId] of [
      [spaceId, org],
      [otherSpace, otherOrg],
    ] as const)
      await prisma.space.create({ data: { id, organizationId, name: "Operations" } });
    for (const [userId, organizationId, memberSpace, role] of [
      [userA, org, spaceId, "owner"],
      [userB, org, spaceId, "member"],
      [userC, otherOrg, otherSpace, "owner"],
    ] as const) {
      await prisma.user.create({
        data: { id: userId, name: "Sample member", email: `${userId}@example.test` },
      });
      await prisma.member.create({
        data: { id: `member-${userId}`, organizationId, userId, role, createdAt: new Date() },
      });
      await prisma.spaceMember.create({
        data: {
          id: `sm-${userId}`,
          organizationId,
          userId,
          spaceId: memberSpace,
          role,
          createdAt: new Date(),
        },
      });
    }
    workspaceId = (
      await prisma.workspace.create({
        data: { organizationId: org, name: "Harbor operations", slug: stamp, channels: ["voice"] },
      })
    ).id;
    botId = (
      await prisma.bot.create({ data: { ...owner, name: "Operations bot", color: "#123456" } })
    ).id;
    await prisma.workspaceSkill.createMany({
      data: [1, 2].map((version) => ({
        workspaceId,
        name: "callback-playbook",
        version,
        content: `# Callbacks\nVersion ${version}. Check requested callbacks.`,
        createdBy: "import",
      })),
    });
    await prisma.workspaceContext.create({
      data: { workspaceId, key: "office-hours", content: "Weekdays 9–5", updatedBy: "import" },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB, userC] } } });
    await close();
  });
  it("concurrently converts only the latest playbook and records native memory revisions", async () => {
    await Promise.all([
      importWorkspaceKnowledge(prisma, owner),
      importWorkspaceKnowledge(prisma, owner),
    ]);
    const skills = await prisma.agentSkill.findMany({ where: owner });
    expect(skills).toHaveLength(1);
    const parsed = parseSkillMd(skills[0]!.content);
    expect(parsed).not.toHaveProperty("error");
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body).toContain("# Callbacks\nVersion 2. Check requested callbacks.");
    expect(parsed.body).toContain("workspace_rentals instead of get_available_rentals");
    expect(parsed.body).toContain("Do not execute those legacy commands");
    const memory = await prisma.memoryDocument.findMany({
      where: owner,
      include: { revisions: true },
    });
    expect(memory).toHaveLength(1);
    expect(memory[0]).toMatchObject({ scope: "user", content: "Weekdays 9–5", revision: 1 });
    expect(memory[0]!.revisions).toHaveLength(1);
    expect(await prisma.workspaceKnowledgeImport.count({ where: owner })).toBe(1);
  });
  it("preserves edited memory and deleted skills on later visits", async () => {
    await prisma.agentSkill.deleteMany({ where: owner });
    await prisma.memoryDocument.updateMany({
      where: owner,
      data: { content: "Member's corrected hours" },
    });
    await importWorkspaceKnowledge(prisma, owner);
    expect(await prisma.agentSkill.count({ where: owner })).toBe(0);
    expect((await prisma.memoryDocument.findFirstOrThrow({ where: owner })).content).toBe(
      "Member's corrected hours",
    );
    expect(await prisma.workspaceSkill.count({ where: { workspaceId } })).toBe(2);
  });
  it("converts independently for another member without copying personal edits", async () => {
    await importWorkspaceKnowledge(prisma, peer);
    expect(await prisma.agentSkill.count({ where: peer })).toBe(1);
    expect((await prisma.memoryDocument.findFirstOrThrow({ where: peer })).content).toBe(
      "Weekdays 9–5",
    );
  });
  it("rejects membership spoofing and returns no workspace in another organization", async () => {
    await expect(workspaceForAgent(prisma, { spaceId, userId: userC })).rejects.toThrow();
    expect(
      await importWorkspaceKnowledge(prisma, { spaceId: otherSpace, userId: userC }),
    ).toBeNull();
  });
  it("does not leak a report from another organization", async () => {
    const foreign = await prisma.workspace.create({
      data: { organizationId: otherOrg, slug: `other-${stamp}`, name: "Other operations" },
    });
    const report = await prisma.workspaceReport.create({
      data: {
        workspaceId: foreign.id,
        reportType: "voice",
        title: "Private to other workspace",
        report: { summary: "Private to other workspace" },
      },
    });
    const result = await executeWorkspaceTool(
      { prisma },
      { ...owner, botId, executionId: "read" },
      "workspace_report",
      { reportId: report.id },
    );
    expect(result).toEqual({ error: "Workspace record not found or access denied." });
    await prisma.workspace.delete({ where: { id: foreign.id } });
  });
  it("attributes activity to the bot and deduplicates a repeated tool execution", async () => {
    const actor = { ...owner, botId, executionId: `log-${stamp}` };
    const args = {
      channel: "voice",
      title: "Reviewed callbacks",
      summary: "Two requests need follow-up.",
    };
    const first = await executeWorkspaceTool({ prisma }, actor, "workspace_log_activity", args);
    expect(await executeWorkspaceTool({ prisma }, actor, "workspace_log_activity", args)).toEqual(
      first,
    );
    const rows = await prisma.workspaceActivity.findMany({ where: { workspaceId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: "Operations bot",
      verification: "pending",
      kind: "agent_note",
    });
  });
  it("requires a manager to queue an automation and records queue failures", async () => {
    const refused = await executeWorkspaceTool(
      { prisma, jobs },
      { ...peer, botId, executionId: "run-denied" },
      "workspace_run_automation",
      { key: "voice" },
    );
    expect(refused).toMatchObject({
      error: "Only organization owners and admins can run automations.",
    });
    expect(jobs.enqueue).not.toHaveBeenCalled();
    const result = await executeWorkspaceTool(
      { prisma, jobs },
      { ...owner, botId, executionId: "run-ok" },
      "workspace_run_automation",
      { key: "voice" },
    );
    expect(result).toHaveProperty("runId");
    vi.mocked(jobs.enqueue).mockRejectedValueOnce(new Error("private queue detail"));
    expect(
      await executeWorkspaceTool(
        { prisma, jobs },
        { ...owner, botId, executionId: "run-fail" },
        "workspace_run_automation",
        { key: "voice" },
      ),
    ).toEqual({ error: "Could not queue automation. Try again." });
    expect(
      await prisma.workspaceSyncRun.count({
        where: { workspaceId, status: "error", errorMessage: "Could not queue automation." },
      }),
    ).toBe(1);
  });
  it("rolls back the receipt and copies when conversion fails", async () => {
    const foreign = await prisma.workspace.create({
      data: { organizationId: otherOrg, slug: `rollback-${stamp}`, name: "Rollback" },
    });
    await prisma.workspaceSkill.create({
      data: {
        workspaceId: foreign.id,
        name: "oversized",
        content: "x".repeat(100_001),
        createdBy: "import",
      },
    });
    await expect(
      importWorkspaceKnowledge(prisma, { spaceId: otherSpace, userId: userC }),
    ).rejects.toThrow("limit");
    expect(
      await prisma.workspaceKnowledgeImport.count({ where: { workspaceId: foreign.id } }),
    ).toBe(0);
    expect(await prisma.agentSkill.count({ where: { spaceId: otherSpace, userId: userC } })).toBe(
      0,
    );
  });
});
