CREATE TABLE "MaintenanceJob" (
 "id" TEXT PRIMARY KEY, "ownerUserId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "requestId" TEXT NOT NULL, "issue" TEXT NOT NULL, "runId" TEXT, "evidence" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'queued', "review" JSONB, "reviewKey" TEXT, "approvedRevision" TEXT,
 "message" TEXT NOT NULL DEFAULT '', "simulated" BOOLEAN NOT NULL DEFAULT false,
 "version" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "MaintenanceJob_status_check" CHECK ("status" IN ('queued','investigating','review','approved','releasing','completed','failed','blocked','cancelled'))
);
CREATE UNIQUE INDEX "MaintenanceJob_ownerUserId_requestId_key" ON "MaintenanceJob"("ownerUserId", "requestId");
CREATE INDEX "MaintenanceJob_status_nextAttemptAt_idx" ON "MaintenanceJob"("status", "nextAttemptAt");
CREATE INDEX "MaintenanceJob_ownerUserId_createdAt_idx" ON "MaintenanceJob"("ownerUserId", "createdAt");
