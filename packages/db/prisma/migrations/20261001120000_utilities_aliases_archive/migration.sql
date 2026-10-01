-- Alternate address spellings for tracked utility properties, and archived water billing months.
-- AlterTable
ALTER TABLE "workspace_utility_properties" ADD COLUMN "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "archivedUtilityMonths" DATE[] DEFAULT ARRAY[]::DATE[];
