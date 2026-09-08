ALTER TABLE "MaintenanceJob" ADD COLUMN "execution" JSONB,
  ADD COLUMN "executionLeaseUntil" TIMESTAMP(3);
