-- CreateTable
CREATE TABLE "bot_credentials" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "hasPassword" BOOLEAN NOT NULL DEFAULT false,
    "hasTotp" BOOLEAN NOT NULL DEFAULT false,
    "secretId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_credentials_spaceId_botId_idx" ON "bot_credentials"("spaceId", "botId");

-- AddForeignKey
ALTER TABLE "bot_credentials" ADD CONSTRAINT "bot_credentials_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_credentials" ADD CONSTRAINT "bot_credentials_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_credentials" ADD CONSTRAINT "bot_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_credentials" ADD CONSTRAINT "bot_credentials_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
