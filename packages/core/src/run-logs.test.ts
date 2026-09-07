import type { Run, RunDiagnostics } from "@rakazo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunLogsController } from "./run-logs.js";

const run = (id: string) => ({ id }) as Run;
const detail = (id: string, seq = 5, olderCursor: number | null = null): RunDiagnostics => ({
  run: run(id),
  failure: null,
  attempts: [],
  events: [
    {
      id: `event-${seq}`,
      seq,
      type: "run.started",
      createdAt: "2026-01-01T00:00:00Z",
      tool: null,
      status: null,
      durationMs: null,
    },
  ],
  olderCursor,
});
afterEach(() => vi.useRealTimers());
describe("run log controller", () => {
  it("keeps the inspected run selectable after it leaves the recent history window", async () => {
    const transport = {
      history: vi
        .fn()
        .mockResolvedValueOnce({ runs: [run("old")] })
        .mockResolvedValueOnce({ runs: [run("new")] }),
      diagnostics: vi.fn().mockResolvedValue(detail("old")),
    };
    const controller = new RunLogsController("bot-1", transport);
    await controller.refresh();
    await controller.refresh();
    expect(controller.getSnapshot().selectedId).toBe("old");
    expect(controller.getSnapshot().runs.map((run) => run.id)).toEqual(["new", "old"]);
  });
  it("ignores an older selection's response and stops polling on close", async () => {
    vi.useFakeTimers();
    let resolveOld!: (data: RunDiagnostics) => void;
    const transport = {
      history: vi.fn().mockResolvedValue({ runs: [run("old"), run("new")] }),
      diagnostics: vi.fn().mockImplementation(({ runId }) =>
        runId === "old"
          ? new Promise<RunDiagnostics>((resolve) => {
              resolveOld = resolve;
            })
          : Promise.resolve(detail("new")),
      ),
    };
    const controller = new RunLogsController("bot-1", transport);
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.select("new");
    await vi.advanceTimersByTimeAsync(0);
    resolveOld(detail("old"));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().data?.run.id).toBe("new");
    controller.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(transport.history).toHaveBeenCalledTimes(2);
  });
  it("preserves loaded earlier events across polls without duplicates", async () => {
    const transport = {
      history: vi.fn().mockResolvedValue({ runs: [run("one")] }),
      diagnostics: vi
        .fn()
        .mockResolvedValueOnce(detail("one", 5, 5))
        .mockResolvedValueOnce(detail("one", 1))
        .mockResolvedValueOnce(detail("one", 5, 5)),
    };
    const controller = new RunLogsController("bot-1", transport);
    await controller.refresh();
    await controller.loadOlder();
    await controller.refresh();
    expect(controller.getSnapshot().data?.events.map((event) => event.seq)).toEqual([1, 5]);
    expect(controller.getSnapshot().data?.olderCursor).toBeNull();
  });
});
