import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";
import {
  ensureDefaultAutomations,
  listWorkspaceAutomations,
  updateWorkspaceAutomation,
} from "./workspace-automations.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const NOW = new Date("2026-09-04T12:30:00Z");

describePostgres("workspace automations (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `auto-org-${suffix}`;
  const workspaceId = `auto-workspace-${suffix}`;
  const workspace = { id: workspaceId, channels: ["voice", "utilities"] };
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    await prisma.organization.create({
      data: { id: organizationId, name: "Automations", slug: organizationId, createdAt: NOW },
    });
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        organizationId,
        name: "Automations",
        slug: `automations-${suffix}`,
        channels: workspace.channels,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await close();
  });

  it("seeds one automation per channel pipe, armed with its first wakeup, idempotently", async () => {
    await ensureDefaultAutomations(prisma, workspace, NOW);
    const first = await listWorkspaceAutomations(prisma, workspaceId, NOW);
    expect(first.map((row) => [row.key, row.pipeline, row.enabled, row.status])).toEqual([
      ["voice", "zoho-agent-logs", true, "idle"],
      ["water", "water", true, "idle"],
      ["recap", "recap", true, "idle"],
    ]);
    expect(first[0]!.nextRunAt).toBe("2026-09-04T12:40:00.000Z");
    expect(first[1]!.nextRunAt).toBe("2026-09-07T12:00:00.000Z");
    expect(first[0]!.timezone).toBe("America/New_York");
    expect(first[0]!.lastRun).toBeNull();

    // A second call changes nothing, even after a row was customised.
    await prisma.workspaceAutomation.update({
      where: { workspaceId_key: { workspaceId, key: "water" } },
      data: { enabled: false, crons: ["0 7 * * 1"] },
    });
    await ensureDefaultAutomations(prisma, workspace, NOW);
    const second = await listWorkspaceAutomations(prisma, workspaceId, NOW);
    expect(second).toHaveLength(3);
    expect(second.find((row) => row.key === "water")).toMatchObject({
      enabled: false,
      crons: ["0 7 * * 1"],
    });
  });

  it("lists the newest run and judges status from it", async () => {
    const automation = await prisma.workspaceAutomation.findUniqueOrThrow({
      where: { workspaceId_key: { workspaceId, key: "voice" } },
    });
    await prisma.workspaceSyncRun.createMany({
      data: [
        {
          workspaceId,
          automationId: automation.id,
          status: "success",
          startedAt: new Date(NOW.getTime() - 3_600_000),
          finishedAt: new Date(NOW.getTime() - 3_500_000),
          recordsLoaded: 8,
        },
        {
          workspaceId,
          automationId: automation.id,
          status: "error",
          startedAt: new Date(NOW.getTime() - 600_000),
          finishedAt: new Date(NOW.getTime() - 590_000),
          errorMessage: "token expired",
        },
      ],
    });
    const listed = await listWorkspaceAutomations(prisma, workspaceId, NOW);
    const voice = listed.find((row) => row.key === "voice")!;
    expect(voice.status).toBe("failing");
    expect(voice.lastRun).toMatchObject({ status: "error", errorMessage: "token expired" });
  });

  it("updates the schedule strictly and recomputes the next wakeup", async () => {
    await expect(
      updateWorkspaceAutomation(prisma, workspaceId, { key: "voice", crons: ["bogus"] }, NOW),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      updateWorkspaceAutomation(prisma, workspaceId, { key: "instagram" }, NOW),
    ).rejects.toBeInstanceOf(IsolationError);

    const hourly = await updateWorkspaceAutomation(
      prisma,
      workspaceId,
      { key: "voice", crons: ["0 * * * *"] },
      NOW,
    );
    expect(hourly.crons).toEqual(["0 * * * *"]);
    expect(hourly.nextRunAt).toBe("2026-09-04T13:00:00.000Z");

    const paused = await updateWorkspaceAutomation(
      prisma,
      workspaceId,
      { key: "voice", enabled: false },
      NOW,
    );
    expect(paused).toMatchObject({ enabled: false, nextRunAt: null });

    const resumed = await updateWorkspaceAutomation(
      prisma,
      workspaceId,
      { key: "voice", enabled: true },
      NOW,
    );
    expect(resumed).toMatchObject({ enabled: true, nextRunAt: "2026-09-04T13:00:00.000Z" });
  });
});
