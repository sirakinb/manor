-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "waterGlAccountId" INTEGER,
ADD COLUMN "buildiumChargeDescription" TEXT NOT NULL DEFAULT 'Water bill';

-- CreateTable
CREATE TABLE "workspace_credentials" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "secretId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_credentials_workspaceId_provider_key" ON "workspace_credentials"("workspaceId", "provider");

-- AddForeignKey
ALTER TABLE "workspace_credentials" ADD CONSTRAINT "workspace_credentials_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_credentials" ADD CONSTRAINT "workspace_credentials_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
