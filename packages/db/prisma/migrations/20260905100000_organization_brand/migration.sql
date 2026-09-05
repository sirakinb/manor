-- AlterTable
ALTER TABLE "organization" ADD COLUMN "brandId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organization_brandId_key" ON "organization"("brandId");
