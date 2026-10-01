-- Alternate address spellings for tracked utility properties, and archived water bills.
-- AlterTable
ALTER TABLE "workspace_utility_properties" ADD COLUMN "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "workspace_water_bills" ADD COLUMN "archivedAt" TIMESTAMP(3);
