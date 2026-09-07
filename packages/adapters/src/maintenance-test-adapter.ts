import type { MaintenanceAdapter } from "@rakazo/adapter-kit";

/** Explicit dependency injection for offline tests only. Never selected by an env flag. */
export class TestMaintenanceAdapter implements MaintenanceAdapter {
  readonly mode = "test" as const;
  async investigate(
    _input?: Parameters<MaintenanceAdapter["investigate"]>[0],
  ): ReturnType<MaintenanceAdapter["investigate"]> {
    return {
      status: "review",
      review: {
        baseRevision: "a".repeat(40),
        revision: "b".repeat(40),
        branch: "maintenance/synthetic-fix",
        diff: "diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-export const status = 'unknown';\n+export const status = 'ready';",
        checks: [{ name: "Synthetic authorization and lifecycle checks", passed: true }],
        isolationVerified: true,
        requiredChecksPassed: true,
        publicationSafe: true,
        previewUrl: null,
        previewSummary:
          "Synthetic preview: the status label reads ready. No real workspace was created.",
        updates: { web: true, desktop: false, mobile: false },
      },
    };
  }
  async release(
    _input?: Parameters<MaintenanceAdapter["release"]>[0],
  ): ReturnType<MaintenanceAdapter["release"]> {
    return { status: "completed" };
  }
}
