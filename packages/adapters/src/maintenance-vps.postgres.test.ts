import { randomUUID } from "node:crypto";
import type { AgentRunRequest } from "@rakazo/adapter-kit";
import { createDb } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMaintenanceService } from "./maintenance.js";
import type { MaintenanceTransport } from "./maintenance-control.js";
import { VpsMaintenanceAdapter } from "./maintenance-vps.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";

const describeDb =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;
describeDb("VPS maintenance orchestration", () => {
  let db: ReturnType<typeof createDb>;
  const owner = randomUUID();
  let previousOwner: string | null;
  const revision = "a".repeat(40);
  const candidate = "b".repeat(40);
  const manifest = {
    revision: candidate,
    releaseId: "c".repeat(64),
    manifestHash: "c".repeat(64),
    policyHash: "d".repeat(64),
    evidenceHash: "e".repeat(64),
    imageId: `sha256:${"f".repeat(64)}`,
  };
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    previousOwner =
      (await db.prisma.deploymentSettings.findUnique({ where: { id: "default" } }))?.ownerUserId ??
      null;
    await db.prisma.user.create({
      data: { id: owner, name: "Synthetic owner", email: `${owner}@example.test` },
    });
    await db.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ownerUserId: owner },
      update: { ownerUserId: owner },
    });
  });
  afterAll(async () => {
    if (!db) return;
    await db.prisma.deploymentSettings.update({
      where: { id: "default" },
      data: { ownerUserId: previousOwner },
    });
    await db.prisma.user.delete({ where: { id: owner } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });
  function fixture(
    options: { forbiddenTool?: boolean; prepareFailed?: boolean; interruptedDeploy?: boolean } = {},
  ) {
    const requests: Array<{ role: string; path: string; body: Record<string, unknown> }> = [];
    const control: MaintenanceTransport = {
      call: vi.fn(async (role, path, raw) => {
        if (path === "/v1/releases") return [manifest];
        const body = raw as Record<string, unknown>;
        requests.push({ role, path, body });
        let result: unknown = { ok: true, output: "Synthetic command result" };
        if (body.action === "submit") result = { revision: candidate };
        if (body.action === "review")
          result = {
            baseRevision: revision,
            revision: candidate,
            diff: "Synthetic private diff",
            compatible: true,
            files: ["apps/web/src/example.ts"],
          };
        return {
          requestId: body.requestId,
          state:
            options.prepareFailed && body.action === "prepare"
              ? "failed"
              : options.interruptedDeploy && body.action === "deploy"
                ? "interrupted"
                : "succeeded",
          result,
          releaseId: manifest.releaseId,
        };
      }),
    };
    const runtime = new ScriptedAgentRuntime();
    runtime.run = vi.fn(async function* (request: AgentRunRequest) {
      expect(request.tools.map((tool) => tool.name)).toEqual(["workspace_exec"]);
      expect(JSON.stringify(request)).not.toContain("MAINTENANCE_OWNER_TOKEN");
      await request.executeTool!(
        options.forbiddenTool ? "deploy" : "workspace_exec",
        { argv: ["git", "diff"] },
        "synthetic-command",
      );
      yield { type: "done" as const };
    });
    const adapter = new VpsMaintenanceAdapter({
      prisma: db.prisma,
      runtime,
      control,
      revision,
      model: { provider: "scripted", model: "scripted", key: undefined },
    });
    const service = createMaintenanceService(db.prisma, adapter);
    return { adapter, service, requests, runtime };
  }
  async function review(f: ReturnType<typeof fixture>) {
    const job = await f.service.create(
      owner,
      { requestId: randomUUID(), issue: "Fix a synthetic label" },
      {},
    );
    await f.service.advance(job.id);
    return (await f.service.list(owner)).jobs.find((entry) => entry.id === job.id)!;
  }
  it("captures an independently prepared manifest and deploys only after exact owner approval", async () => {
    const f = fixture();
    const job = await review(f);
    expect(job.status).toBe("review");
    expect(job.review?.release?.manifestHash).toBe(manifest.manifestHash);
    expect(f.requests.some((request) => request.role === "owner")).toBe(false);
    await f.service.approve(owner, { id: job.id, revision: candidate, reviewKey: job.reviewKey! });
    await f.service.advance(job.id);
    expect((await f.service.list(owner)).jobs.find((entry) => entry.id === job.id)?.status).toBe(
      "completed",
    );
    expect(
      f.requests
        .filter((request) => request.role === "owner")
        .map((request) => request.body.action),
    ).toEqual(["approve"]);
  });
  it("refuses invented model tools before any host or release request", async () => {
    const f = fixture({ forbiddenTool: true });
    expect((await review(f)).status).toBe("failed");
    expect(f.requests.some((request) => request.path === "/v1/operations")).toBe(false);
  });
  it("does not present a passing review after independent preparation fails", async () => {
    const f = fixture({ prepareFailed: true });
    expect((await review(f)).status).toBe("failed");
    expect(f.requests.some((request) => request.role === "owner")).toBe(false);
  });
  it("reports an interrupted deployment as failure without issuing recovery automatically", async () => {
    const f = fixture({ interruptedDeploy: true });
    const job = await review(f);
    await f.service.approve(owner, { id: job.id, revision: candidate, reviewKey: job.reviewKey! });
    await f.service.advance(job.id);
    expect((await f.service.list(owner)).jobs.find((entry) => entry.id === job.id)?.status).toBe(
      "failed",
    );
    expect(f.requests.some((request) => request.body.action === "recover")).toBe(false);
  });
  it("fences a forged manifest even if the supplied revision and review key are approved", async () => {
    const f = fixture();
    const job = await review(f);
    await f.service.approve(owner, { id: job.id, revision: candidate, reviewKey: job.reviewKey! });
    await db.prisma.maintenanceJob.update({ where: { id: job.id }, data: { status: "releasing" } });
    const before = f.requests.length;
    expect(
      await f.adapter.release({
        operationId: `${job.id}:release:${candidate}`,
        ownerUserId: owner,
        revision: candidate,
        reviewKey: job.reviewKey!,
        review: {
          ...job.review!,
          release: { ...job.review!.release!, manifestHash: "0".repeat(64) },
        },
        signal: AbortSignal.timeout(5000),
      }),
    ).toEqual({ status: "failed" });
    expect(f.requests).toHaveLength(before);
  });
  it("keeps restart state but never replays an uncertain coding turn", async () => {
    const f = fixture();
    const job = await f.service.create(
      owner,
      { requestId: randomUUID(), issue: "Synthetic interrupted turn" },
      {},
    );
    await db.prisma.maintenanceJob.update({
      where: { id: job.id },
      data: {
        status: "investigating",
        execution: { state: "running" },
        executionLeaseUntil: new Date(0),
      },
    });
    await f.service.advance(job.id);
    expect((await f.service.list(owner)).jobs.find((entry) => entry.id === job.id)?.status).toBe(
      "failed",
    );
    expect(f.runtime.run).not.toHaveBeenCalled();
    expect(f.requests).toEqual([]);
  });
});
