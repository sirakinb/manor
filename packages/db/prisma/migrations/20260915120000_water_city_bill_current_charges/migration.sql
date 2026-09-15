-- AlterTable
ALTER TABLE "workspace_water_bills" ADD COLUMN "currentCharges" DOUBLE PRECISION,
ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'wrd_email';

-- CreateIndex
CREATE INDEX "workspace_water_bills_addr_month_idx" ON "workspace_water_bills"("workspaceId", "serviceAddressNorm", "billingMonth");
