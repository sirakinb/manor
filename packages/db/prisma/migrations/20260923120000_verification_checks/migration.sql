-- Verifier engine choice and compare mode on the Auto Review preference, plus a per-engine check log.
-- AlterTable
ALTER TABLE "action_auto_review_preferences" ADD COLUMN     "compare" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "engine" TEXT NOT NULL DEFAULT 'llm';

-- CreateTable
CREATE TABLE "verification_checks" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "effectId" TEXT,
    "checkpoint" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "probability" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "details" JSONB,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_checks_spaceId_userId_createdAt_idx" ON "verification_checks"("spaceId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "verification_checks_effectId_engine_key" ON "verification_checks"("effectId", "engine");

-- AddForeignKey
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_effectId_fkey" FOREIGN KEY ("effectId") REFERENCES "external_effects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

