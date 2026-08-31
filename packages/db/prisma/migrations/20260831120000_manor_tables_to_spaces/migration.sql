BEGIN;

-- Metadata-only renames want prompt failure under lock contention, same as
-- upstream's 20260830200000 space rename.
SET LOCAL lock_timeout = '5s';

-- Manor's CRM and integration tables follow the org->space re-parenting from
-- 20260830150000. Every existing workspaceId value is an organization id, and
-- each organization's default space reuses that id, so the data needs no
-- rewriting -- only the column names and foreign keys move.
ALTER TABLE "integration_credentials" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "integration_idempotency_keys" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "crm_contacts" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "crm_contact_external_ids" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "crm_tags" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "crm_pipelines" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "crm_deals" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "crm_modules" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "crm_module_records" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "crm_webhook_endpoints" RENAME COLUMN "workspaceId" TO "spaceId";
ALTER TABLE "crm_webhook_events" RENAME COLUMN "workspaceId" TO "spaceId";

-- Re-point the relation-bearing tables' foreign keys from organization to
-- spaces. NOT VALID + VALIDATE, matching upstream's pattern.
ALTER TABLE "integration_credentials" DROP CONSTRAINT IF EXISTS "integration_credentials_workspaceId_fkey";
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_space_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "integration_idempotency_keys" DROP CONSTRAINT IF EXISTS "integration_idempotency_keys_workspaceId_fkey";
ALTER TABLE "integration_idempotency_keys" ADD CONSTRAINT "integration_idempotency_keys_space_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "crm_contact_external_ids" DROP CONSTRAINT IF EXISTS "crm_contact_external_ids_workspaceId_fkey";
ALTER TABLE "crm_contact_external_ids" ADD CONSTRAINT "crm_contact_external_ids_space_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "crm_webhook_endpoints" DROP CONSTRAINT IF EXISTS "crm_webhook_endpoints_workspaceId_fkey";
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_space_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "crm_webhook_events" DROP CONSTRAINT IF EXISTS "crm_webhook_events_workspaceId_fkey";
ALTER TABLE "crm_webhook_events" ADD CONSTRAINT "crm_webhook_events_space_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "integration_credentials" VALIDATE CONSTRAINT "integration_credentials_space_fkey";
ALTER TABLE "integration_idempotency_keys" VALIDATE CONSTRAINT "integration_idempotency_keys_space_fkey";
ALTER TABLE "crm_contact_external_ids" VALIDATE CONSTRAINT "crm_contact_external_ids_space_fkey";
ALTER TABLE "crm_webhook_endpoints" VALIDATE CONSTRAINT "crm_webhook_endpoints_space_fkey";
ALTER TABLE "crm_webhook_events" VALIDATE CONSTRAINT "crm_webhook_events_space_fkey";

COMMIT;
