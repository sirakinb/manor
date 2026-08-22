-- AlterTable
ALTER TABLE "computers" ALTER COLUMN "scope" SET DEFAULT 'team';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "authorBotId" TEXT;

-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN     "name" TEXT,
ALTER COLUMN "botId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "thread_participants" (
    "threadId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_participants_pkey" PRIMARY KEY ("threadId","botId")
);

-- CreateIndex
CREATE INDEX "thread_participants_botId_idx" ON "thread_participants"("botId");

-- CreateIndex
CREATE INDEX "threads_workspaceId_kind_idx" ON "threads"("workspaceId", "kind");

-- AddForeignKey
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_authorBotId_fkey" FOREIGN KEY ("authorBotId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
