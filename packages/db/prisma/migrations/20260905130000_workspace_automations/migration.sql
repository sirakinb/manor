-- CreateTable
CREATE TABLE "workspace_automations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "crons" TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_automations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "workspace_sync_runs" ADD COLUMN "automationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "workspace_automations_workspaceId_key_key" ON "workspace_automations"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "workspace_automations_enabled_nextRunAt_idx" ON "workspace_automations"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "workspace_sync_runs_automationId_startedAt_idx" ON "workspace_sync_runs"("automationId", "startedAt");

-- AddForeignKey
ALTER TABLE "workspace_automations" ADD CONSTRAINT "workspace_automations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_sync_runs" ADD CONSTRAINT "workspace_sync_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "workspace_automations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
