import type { BackgroundJob, JobPublisher } from "@rakazo/adapter-kit";
import { createDb, ensureDefaultAutomations, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeIngestionRunner } from "./ingestion-runner.js";
import { EncryptedSecretStore } from "./secrets.js";
import { runWorkspaceAutomation } from "./workspace-automation-runner.js";
import { saveWorkspaceCredential } from "./workspace-credentials.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const NOW = new Date("2026-09-04T12:40:00Z");

class RecordingJobs implements JobPublisher {
  readonly jobs: BackgroundJob[] = [];
  async enqueue(job: BackgroundJob) {
    this.jobs.push(job);
  }
  async cancel() {}
  async close() {}
}

describePostgres("runWorkspaceAutomation (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `runner-org-${suffix}`;
  const workspaceId = `runner-workspace-${suffix}`;
  const userId = `runner-user-${suffix}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let secrets: EncryptedSecretStore;
  let ingestion: FakeIngestionRunner;
  let jobs: RecordingJobs;
  let voiceId: string;
  let listingsId: string;

  const deps = () => ({ prisma, secrets, jobs, ingestion, now: () => NOW });

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    secrets = new EncryptedSecretStore("runner-test-key");
    await prisma.user.create({
      data: { id: userId, name: userId, email: `${userId}@rakazo.test`, emailVerified: false },
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "Runner", slug: organizationId, createdAt: NOW },
    });
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        organizationId,
        name: "Runner Rentals",
        slug: `runner-${suffix}`,
        channels: ["voice", "leasing"],
        monthlyVoiceReportDay: 0,
        monthlyVoiceReportHour: 9,
      },
    });
    await ensureDefaultAutomations(
      prisma,
      { id: workspaceId, channels: ["voice", "leasing"] },
      NOW,
    );
    const rows = await prisma.workspaceAutomation.findMany({ where: { workspaceId } });
    voiceId = rows.find((row) => row.key === "voice")!.id;
    listingsId = rows.find((row) => row.key === "listings")!.id;
    await prisma.workspaceSource.create({
      data: {
        workspaceId,
        name: "Listings",
        sourceType: "leasing",
        config: { remaUrl: "https://example.test/listings", sheetId: "sheet-1" },
      },
    });
  });

  beforeEach(() => {
    ingestion = new FakeIngestionRunner();
    jobs = new RecordingJobs();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await close();
  });

  const runsFor = (automationId: string) =>
    prisma.workspaceSyncRun.findMany({
      where: { automationId },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      include: { source: true },
    });

  it("sends only OpenAI credentials to recaps when OpenAI is configured", async () => {
    await saveWorkspaceCredential(
      prisma,
      secrets,
      { workspaceId, userId },
      {
        provider: "openai",
        fields: { apiKey: "fake-openai-key", model: "gpt-5.6-luna" },
      },
    );
    const automation = await prisma.workspaceAutomation.findUniqueOrThrow({
      where: { workspaceId_key: { workspaceId, key: "recap" } },
    });
    await runWorkspaceAutomation(deps(), { automationId: automation.id });
    expect(ingestion.requests).toHaveLength(1);
    expect(ingestion.requests[0]?.credentials).toEqual({
      openai: { apiKey: "fake-openai-key", model: "gpt-5.6-luna" },
    });
    const [run] = await runsFor(automation.id);
    expect(run!.status).toBe("success");
  });

  it("records a failed run when the ingestion service is not configured", async () => {
    await runWorkspaceAutomation({ ...deps(), ingestion: undefined }, { automationId: listingsId });
    const [run] = await runsFor(listingsId);
    expect(run).toMatchObject({
      status: "error",
      errorMessage: "ingestion service not configured",
      recordsLoaded: 0,
      finishedAt: NOW,
    });
    expect(run!.source).toMatchObject({ name: "Listings", status: "error" });
    // A manual run still re-arms the schedule.
    expect(jobs.jobs).toEqual([
      expect.objectContaining({
        name: "workspace.automation.run",
        payload: { automationId: listingsId, scheduledFor: "2026-09-05T10:30:00.000Z" },
      }),
    ]);
  });

  it("fails before calling out when a required credential is missing", async () => {
    await runWorkspaceAutomation(deps(), { automationId: voiceId });
    const [run] = await runsFor(voiceId);
    expect(run).toMatchObject({ status: "error", errorMessage: "missing zoho-crm credential" });
    expect(run!.source).toMatchObject({ name: "Zoho CRM", sourceType: "voice" });
    expect(ingestion.requests).toEqual([]);
  });

  it("hands the pipeline its credentials and source config, then records success", async () => {
    await saveWorkspaceCredential(
      prisma,
      secrets,
      { workspaceId, userId },
      {
        provider: "zoho-crm",
        fields: { clientId: "zc", clientSecret: "zs", refreshToken: "zr" },
      },
    );
    await saveWorkspaceCredential(
      prisma,
      secrets,
      { workspaceId, userId },
      { provider: "buildium", fields: { clientId: "b", clientSecret: "b" } },
    );
    ingestion.results.set("zoho-agent-logs", { ok: true, recordsLoaded: 42, notes: "3 new calls" });

    await runWorkspaceAutomation(deps(), { automationId: voiceId });

    expect(ingestion.requests).toHaveLength(1);
    const request = ingestion.requests[0]!;
    expect(request.pipeline).toBe("zoho-agent-logs");
    expect(request.workspaceId).toBe(workspaceId);
    // Only the pipeline's own provider is sent, never every stored credential.
    expect(Object.keys(request.credentials)).toEqual(["zoho-crm"]);
    expect(request.credentials["zoho-crm"]).toEqual({
      clientId: "zc",
      clientSecret: "zs",
      refreshToken: "zr",
    });
    expect(request.options).toMatchObject({
      manual: true,
      scheduledFor: null,
      timezone: "America/New_York",
      workspace: { name: "Runner Rentals", monthlyVoiceReportDay: 0, monthlyVoiceReportHour: 9 },
    });

    const [run] = await runsFor(voiceId);
    expect(run).toMatchObject({ status: "success", recordsLoaded: 42, errorMessage: null });
    expect(run!.id).toBe(request.runId);
    expect(run!.metadata).toEqual({ notes: "3 new calls" });
    expect(run!.source).toMatchObject({ status: "connected", lastSyncedAt: NOW });
    const automation = await prisma.workspaceAutomation.findUniqueOrThrow({
      where: { id: voiceId },
    });
    expect(automation.lastRunAt).toEqual(NOW);
  });

  it("reuses an imported source when its name has different capitalization", async () => {
    const source = await prisma.workspaceSource.create({
      data: {
        workspaceId,
        name: "buildium",
        sourceType: "leasing",
        config: { imported: true },
      },
    });
    await saveWorkspaceCredential(
      prisma,
      secrets,
      { workspaceId, userId },
      { provider: "buildium", fields: { clientId: "fake-id", clientSecret: "fake-secret" } },
    );
    const automation = await prisma.workspaceAutomation.findUniqueOrThrow({
      where: { workspaceId_key: { workspaceId, key: "buildium" } },
    });
    await runWorkspaceAutomation(deps(), { automationId: automation.id });
    await runWorkspaceAutomation(deps(), { automationId: automation.id });
    expect(
      await prisma.workspaceSource.count({
        where: { workspaceId, name: { equals: "Buildium", mode: "insensitive" } },
      }),
    ).toBe(1);
    expect(ingestion.requests[0]!.options).toMatchObject({ imported: true });
    const runs = await runsFor(automation.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.sourceId === source.id && run.status === "success")).toBe(true);
  });

  it("passes the source's stored config as options", async () => {
    await runWorkspaceAutomation(deps(), { automationId: listingsId });
    expect(ingestion.requests[0]!.options).toMatchObject({
      remaUrl: "https://example.test/listings",
      sheetId: "sheet-1",
    });
    expect(ingestion.requests[0]!.credentials).toEqual({});
  });

  it("records a thrown transport error, truncated, and marks the source", async () => {
    ingestion.results.set("zoho-agent-logs", new Error(`boom ${"x".repeat(400)}`));
    await runWorkspaceAutomation(deps(), { automationId: voiceId });
    const [run] = await runsFor(voiceId);
    expect(run!.status).toBe("error");
    expect(run!.errorMessage).toHaveLength(300);
    expect(run!.source).toMatchObject({ status: "error" });
  });

  it("only honours the wakeup the automation is armed for, and re-arms the next one", async () => {
    const before = await prisma.workspaceAutomation.findUniqueOrThrow({ where: { id: voiceId } });
    const runsBefore = (await runsFor(voiceId)).length;

    // Stale: a wakeup for a time that is no longer the armed nextRunAt.
    await runWorkspaceAutomation(deps(), {
      automationId: voiceId,
      scheduledFor: "2026-09-04T12:00:00.000Z",
    });
    expect((await runsFor(voiceId)).length).toBe(runsBefore);

    // Armed: matches nextRunAt exactly. Run it, and expect the next 10-minute slot armed.
    const armed = before.nextRunAt!;
    await runWorkspaceAutomation(
      { ...deps(), now: () => armed },
      { automationId: voiceId, scheduledFor: armed.toISOString() },
    );
    expect((await runsFor(voiceId)).length).toBe(runsBefore + 1);
    const after = await prisma.workspaceAutomation.findUniqueOrThrow({ where: { id: voiceId } });
    expect(after.lastRunAt).toEqual(armed);
    expect(after.nextRunAt!.getTime()).toBe(armed.getTime() + 10 * 60_000);
    expect(jobs.jobs.at(-1)).toMatchObject({
      payload: { automationId: voiceId, scheduledFor: after.nextRunAt!.toISOString() },
    });

    // Paused automations drop their wakeups.
    await prisma.workspaceAutomation.update({ where: { id: voiceId }, data: { enabled: false } });
    await runWorkspaceAutomation(deps(), {
      automationId: voiceId,
      scheduledFor: after.nextRunAt!.toISOString(),
    });
    expect((await runsFor(voiceId)).length).toBe(runsBefore + 1);
    await prisma.workspaceAutomation.update({ where: { id: voiceId }, data: { enabled: true } });
  });

  it("reuses a pre-created run row for a manual run", async () => {
    const queued = await prisma.workspaceSyncRun.create({
      data: { workspaceId, automationId: voiceId, status: "queued", startedAt: NOW },
    });
    await runWorkspaceAutomation(deps(), { automationId: voiceId, runId: queued.id });
    const row = await prisma.workspaceSyncRun.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.status).toBe("success");
    expect(row.sourceId).not.toBeNull();
    expect(ingestion.requests.at(-1)!.runId).toBe(queued.id);
  });
});
