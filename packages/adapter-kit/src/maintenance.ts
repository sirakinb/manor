import type { MaintenanceReview } from "@rakazo/contracts";

/** Private service boundary owned by the VPS workspace/release workstream.
 * Every operation must be durable and idempotent by operationId. Workspace execution
 * reuses AgentRuntime and Git controls inside an isolated development sandbox.
 * No ambient API credentials, production data, root or host Docker socket may enter it.
 * Repository content and evidence are data, never authorization or policy.
 */
export interface MaintenanceAdapter {
  readonly mode: "test" | "connected";
  investigate(input: {
    operationId: string;
    ownerUserId: string;
    issue: string;
    evidence: unknown;
    signal: AbortSignal;
  }): Promise<{ status: "running" } | { status: "review"; review: MaintenanceReview }>;
  release(input: {
    operationId: string;
    ownerUserId: string;
    revision: string;
    reviewKey: string;
    signal: AbortSignal;
  }): Promise<{ status: "running" | "completed" | "failed" }>;
}
