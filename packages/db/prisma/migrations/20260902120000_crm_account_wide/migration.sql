BEGIN;

SET LOCAL lock_timeout = '5s';

-- The CRM was space-scoped (20260831120000_manor_tables_to_spaces); one org
-- can hold several spaces, and the ask is one CRM per org, not one per
-- space. This re-parents every crm_* table from spaceId to organizationId.
-- Tables are tiny in production (dozens of rows total across every org), so
-- this runs as one straightforward transaction rather than the NOT VALID /
-- VALIDATE dance used for large-table renames elsewhere in this history.

-- 1. Add the new column (nullable for now) to every crm_ table that carried
--    spaceId.
ALTER TABLE "crm_contacts" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "crm_contact_external_ids" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "crm_tags" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "crm_pipelines" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "crm_deals" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "crm_modules" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "crm_module_records" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "crm_webhook_endpoints" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "crm_webhook_events" ADD COLUMN "organizationId" TEXT;

-- 2. Backfill from each row's current space. Every space has exactly one
--    organization, so this is a plain lookup, not a merge decision.
UPDATE "crm_contacts" t SET "organizationId" = s."organizationId"
  FROM "spaces" s WHERE s.id = t."spaceId";
UPDATE "crm_contact_external_ids" t SET "organizationId" = s."organizationId"
  FROM "spaces" s WHERE s.id = t."spaceId";
UPDATE "crm_tags" t SET "organizationId" = s."organizationId"
  FROM "spaces" s WHERE s.id = t."spaceId";
UPDATE "crm_pipelines" t SET "organizationId" = s."organizationId"
  FROM "spaces" s WHERE s.id = t."spaceId";
UPDATE "crm_deals" t SET "organizationId" = s."organizationId"
  FROM "spaces" s WHERE s.id = t."spaceId";
UPDATE "crm_modules" t SET "organizationId" = s."organizationId"
  FROM "spaces" s WHERE s.id = t."spaceId";
UPDATE "crm_module_records" t SET "organizationId" = s."organizationId"
  FROM "spaces" s WHERE s.id = t."spaceId";
UPDATE "crm_webhook_endpoints" t SET "organizationId" = s."organizationId"
  FROM "spaces" s WHERE s.id = t."spaceId";
UPDATE "crm_webhook_events" t SET "organizationId" = s."organizationId"
  FROM "spaces" s WHERE s.id = t."spaceId";

-- 3. Merging spaces under the same org can now collide on the two
--    unique-per-space constraints that become unique-per-org. Collapse each
--    collision onto the oldest row before the new constraints are added.

-- 3a. crm_tags (organizationId, name): keep the oldest row per name, point
--     every crm_contact_tags reference at the survivor, drop the rest.
WITH ranked AS (
  SELECT id, "organizationId", name,
         first_value(id) OVER (
           PARTITION BY "organizationId", name ORDER BY "createdAt" ASC, id ASC
         ) AS keep_id
  FROM "crm_tags"
),
losers AS (
  SELECT id, keep_id FROM ranked WHERE id <> keep_id
)
INSERT INTO "crm_contact_tags" ("contactId", "tagId")
SELECT ct."contactId", l.keep_id
FROM "crm_contact_tags" ct
JOIN losers l ON l.id = ct."tagId"
ON CONFLICT ("contactId", "tagId") DO NOTHING;

DELETE FROM "crm_contact_tags" ct
USING (
  SELECT id, first_value(id) OVER (
    PARTITION BY "organizationId", name ORDER BY "createdAt" ASC, id ASC
  ) AS keep_id
  FROM "crm_tags"
) ranked
WHERE ct."tagId" = ranked.id AND ranked.id <> ranked.keep_id;

DELETE FROM "crm_tags" t
USING (
  SELECT id, first_value(id) OVER (
    PARTITION BY "organizationId", name ORDER BY "createdAt" ASC, id ASC
  ) AS keep_id
  FROM "crm_tags"
) ranked
WHERE t.id = ranked.id AND ranked.id <> ranked.keep_id;

-- 3b. crm_contact_external_ids (organizationId, source, externalId): keep
--     the oldest mapping per (source, externalId), drop the rest. A losing
--     row is a duplicate external-system link, not contact data, so nothing
--     the CRM shows is lost.
DELETE FROM "crm_contact_external_ids" e
USING (
  SELECT id, first_value(id) OVER (
    PARTITION BY "organizationId", source, "externalId" ORDER BY "createdAt" ASC, id ASC
  ) AS keep_id
  FROM "crm_contact_external_ids"
) ranked
WHERE e.id = ranked.id AND ranked.id <> ranked.keep_id;

-- 4. Every row now has an organizationId; enforce it.
ALTER TABLE "crm_contacts" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "crm_contact_external_ids" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "crm_tags" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "crm_pipelines" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "crm_deals" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "crm_modules" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "crm_module_records" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "crm_webhook_endpoints" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "crm_webhook_events" ALTER COLUMN "organizationId" SET NOT NULL;

-- 5. Drop the old spaceId-keyed foreign keys and indexes.
ALTER TABLE "crm_contact_external_ids" DROP CONSTRAINT "crm_contact_external_ids_space_fkey";
ALTER TABLE "crm_webhook_endpoints" DROP CONSTRAINT "crm_webhook_endpoints_space_fkey";
ALTER TABLE "crm_webhook_events" DROP CONSTRAINT "crm_webhook_events_space_fkey";

DROP INDEX "crm_contact_external_ids_workspaceId_source_externalId_key";
DROP INDEX "crm_contacts_workspaceId_status_idx";
DROP INDEX "crm_deals_workspaceId_pipelineId_idx";
DROP INDEX "crm_module_records_workspaceId_moduleId_createdAt_idx";
DROP INDEX "crm_modules_workspaceId_idx";
DROP INDEX "crm_pipelines_workspaceId_idx";
DROP INDEX "crm_tags_workspaceId_name_key";
DROP INDEX "crm_webhook_endpoints_workspaceId_enabled_idx";
DROP INDEX "crm_webhook_events_workspaceId_createdAt_idx";

-- 6. Drop spaceId now that organizationId fully replaces it.
ALTER TABLE "crm_contacts" DROP COLUMN "spaceId";
ALTER TABLE "crm_contact_external_ids" DROP COLUMN "spaceId";
ALTER TABLE "crm_tags" DROP COLUMN "spaceId";
ALTER TABLE "crm_pipelines" DROP COLUMN "spaceId";
ALTER TABLE "crm_deals" DROP COLUMN "spaceId";
ALTER TABLE "crm_modules" DROP COLUMN "spaceId";
ALTER TABLE "crm_module_records" DROP COLUMN "spaceId";
ALTER TABLE "crm_webhook_endpoints" DROP COLUMN "spaceId";
ALTER TABLE "crm_webhook_events" DROP COLUMN "spaceId";

-- 7. Recreate the indexes/unique constraints on organizationId.
CREATE UNIQUE INDEX "crm_contact_external_ids_organizationId_source_externalId_key" ON "crm_contact_external_ids"("organizationId", "source", "externalId");
CREATE INDEX "crm_contacts_organizationId_status_idx" ON "crm_contacts"("organizationId", "status");
CREATE INDEX "crm_deals_organizationId_pipelineId_idx" ON "crm_deals"("organizationId", "pipelineId");
CREATE INDEX "crm_module_records_organizationId_moduleId_createdAt_idx" ON "crm_module_records"("organizationId", "moduleId", "createdAt");
CREATE INDEX "crm_modules_organizationId_idx" ON "crm_modules"("organizationId");
CREATE INDEX "crm_pipelines_organizationId_idx" ON "crm_pipelines"("organizationId");
CREATE UNIQUE INDEX "crm_tags_organizationId_name_key" ON "crm_tags"("organizationId", "name");
CREATE INDEX "crm_webhook_endpoints_organizationId_enabled_idx" ON "crm_webhook_endpoints"("organizationId", "enabled");
CREATE INDEX "crm_webhook_events_organizationId_createdAt_idx" ON "crm_webhook_events"("organizationId", "createdAt");

-- 8. Every crm_ table now gets a real, enforced foreign key to organization
--    -- six of them (contacts, tags, pipelines, deals, modules, module
--    records) never had one at the DB level even under spaceId; this closes
--    that gap rather than carrying it forward under a new column name.
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contact_external_ids" ADD CONSTRAINT "crm_contact_external_ids_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_modules" ADD CONSTRAINT "crm_modules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_module_records" ADD CONSTRAINT "crm_module_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_events" ADD CONSTRAINT "crm_webhook_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
