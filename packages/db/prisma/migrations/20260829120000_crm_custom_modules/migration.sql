-- CreateTable
CREATE TABLE "crm_modules" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_module_fields" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_module_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_module_records" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_module_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_modules_workspaceId_idx" ON "crm_modules"("workspaceId");

-- CreateIndex
CREATE INDEX "crm_module_fields_moduleId_idx" ON "crm_module_fields"("moduleId");

-- CreateIndex
CREATE INDEX "crm_module_records_workspaceId_moduleId_createdAt_idx" ON "crm_module_records"("workspaceId", "moduleId", "createdAt");

-- AddForeignKey
ALTER TABLE "crm_module_fields" ADD CONSTRAINT "crm_module_fields_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "crm_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_module_records" ADD CONSTRAINT "crm_module_records_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "crm_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
