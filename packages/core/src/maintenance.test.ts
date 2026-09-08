import type { MaintenanceJob, MaintenanceOverview } from "@rakazo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { maintenanceCanApprove, maintenanceUpdateAdvice } from "./maintenance.js";
import { MaintenanceController, type MaintenanceTransport } from "./maintenance-controller.js";

const job: MaintenanceJob = {
  id: "job-1",
  issue: "Synthetic issue",
  runId: null,
  status: "review",
  reviewKey: "digest",
  approvedRevision: null,
  message: "Ready",
  simulated: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  review: {
    baseRevision: "a".repeat(40),
    revision: "b".repeat(40),
    branch: "maintenance/test",
    diff: "synthetic diff",
    checks: [{ name: "Tests", passed: true }],
    isolationVerified: true,
    requiredChecksPassed: true,
    publicationSafe: true,
    previewUrl: null,
    previewSummary: "Preview",
    updates: { web: true, desktop: false, mobile: true },
  },
};
const overview: MaintenanceOverview = { mode: "connected", jobs: [job] };
function transport(): MaintenanceTransport {
  return {
    list: vi.fn().mockResolvedValue(overview),
    create: vi.fn().mockResolvedValue(job),
    approve: vi.fn().mockResolvedValue(job),
    cancel: vi.fn().mockResolvedValue(job),
  };
}
afterEach(() => vi.useRealTimers());

describe("shared maintenance behavior", () => {
  it("disables approval when checks or publication review fail", () => {
    expect(maintenanceCanApprove(job)).toBe(true);
    for (const patch of [
      { requiredChecksPassed: false },
      { publicationSafe: false },
      { checks: [] },
      { checks: [{ name: "Tests", passed: false }] },
    ])
      expect(maintenanceCanApprove({ ...job, review: { ...job.review!, ...patch } })).toBe(false);
    expect(maintenanceCanApprove({ ...job, status: "completed" })).toBe(false);
  });
  it("distinguishes web reloads, desktop installers, mobile updates and simulation", () => {
    const advice = maintenanceUpdateAdvice({ ...job, status: "completed" });
    expect(advice).toContain("Save unsent work");
    expect(advice).toContain("does not need a new installer");
    expect(advice).toContain("new mobile release");
    expect(maintenanceUpdateAdvice({ ...job, simulated: true, status: "completed" })).toContain(
      "no source code or deployment was changed",
    );
  });
  it("discards stale refresh results after unmount", async () => {
    const api = transport();
    let resolve!: (value: MaintenanceOverview) => void;
    vi.mocked(api.list).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const controller = new MaintenanceController(api);
    controller.start();
    controller.stop();
    resolve(overview);
    await Promise.resolve();
    expect(controller.getSnapshot().data).toBeNull();
  });
  it("clears private data when access is lost", async () => {
    const api = transport();
    const controller = new MaintenanceController(api);
    await controller.refresh();
    expect(controller.getSnapshot().data).toEqual(overview);
    vi.mocked(api.list).mockRejectedValue(new Error("forbidden"));
    await controller.refresh();
    expect(controller.getSnapshot().data).toBeNull();
    expect(controller.getSnapshot().error).toContain("deployment-owner");
  });
  it("serializes approval clicks and submits the exact displayed review", async () => {
    const api = transport();
    let resolve!: (value: MaintenanceJob) => void;
    vi.mocked(api.approve).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const controller = new MaintenanceController(api);
    const first = controller.approve(job);
    expect(await controller.approve(job)).toBe(false);
    expect(api.approve).toHaveBeenCalledExactlyOnceWith({
      id: job.id,
      revision: job.review!.revision,
      reviewKey: job.reviewKey,
    });
    resolve(job);
    await first;
  });
  it("stops every scheduled poll after a successful mutation", async () => {
    vi.useFakeTimers();
    const api = transport();
    const controller = new MaintenanceController(api);
    controller.start();
    await Promise.resolve();
    await controller.approve(job);
    controller.stop();
    const calls = vi.mocked(api.list).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.list).toHaveBeenCalledTimes(calls);
  });
});
