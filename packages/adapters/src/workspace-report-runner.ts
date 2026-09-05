import type { IngestionRunner } from "@rakazo/adapter-kit";
import { ReportGenerateInputSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { EncryptedSecretStore } from "./secrets.js";
import { loadWorkspaceCredential } from "./workspace-credentials.js";

/** A report ID is the durable request and idempotency key. The ingestion adapter
 * locks that row before generation; delivery never belongs to this job. */
export async function runWorkspaceReport(
  deps: {
    prisma: PrismaClient;
    secrets: EncryptedSecretStore;
    ingestion?: IngestionRunner;
  },
  reportId: string,
): Promise<void> {
  const row = await deps.prisma.workspaceReport.findUnique({
    where: { id: reportId },
    include: { workspace: true },
  });
  if (!row || !["queued", "generating"].includes(row.status) || row.approvedAt || row.sentAt)
    return;
  const pending = {
    id: reportId,
    status: { in: ["queued", "generating"] },
    approvedAt: null,
    sentAt: null,
  };
  try {
    if (!deps.ingestion) throw new Error("No ingestion adapter");
    const body = row.report as { request?: unknown };
    const request = ReportGenerateInputSchema.parse(body.request);
    const openai = await loadWorkspaceCredential(
      deps.prisma,
      deps.secrets,
      row.workspaceId,
      "openai",
    );
    const provider = openai ? "openai" : "openrouter";
    const credential =
      openai ??
      (await loadWorkspaceCredential(deps.prisma, deps.secrets, row.workspaceId, "openrouter"));
    if (!credential) throw new Error("No narrative credential");
    const claimed = await deps.prisma.workspaceReport.updateMany({
      where: pending,
      data: { status: "generating" },
    });
    if (!claimed.count) return;
    const result = await deps.ingestion.run({
      pipeline: "reports",
      runId: reportId,
      workspaceId: row.workspaceId,
      credentials: { [provider]: credential },
      options: {
        reportId,
        request,
        manual: true,
        workspace: { name: row.workspace.name },
        timezone: "America/New_York",
      },
    });
    if (!result.ok) throw new Error("Report generation failed");
    if (await deps.prisma.workspaceReport.count({ where: pending }))
      throw new Error("Report did not finish");
  } catch {
    // Provider and transport errors can contain credentials or raw source data.
    await deps.prisma.workspaceReport.updateMany({
      where: pending,
      data: {
        status: "error",
        summary:
          "Could not generate this report. Check the narrative provider in settings, then try again.",
      },
    });
  }
}
