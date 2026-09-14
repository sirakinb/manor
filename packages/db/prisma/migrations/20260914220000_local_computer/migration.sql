-- CreateTable
CREATE TABLE "local_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Laptop',
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_computer_sessions" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "lastCommand" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "local_computer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_computer_commands" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "local_computer_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_devices_tokenHash_key" ON "local_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "local_devices_userId_spaceId_idx" ON "local_devices"("userId", "spaceId");

-- CreateIndex
CREATE INDEX "local_computer_sessions_deviceId_connected_idx" ON "local_computer_sessions"("deviceId", "connected");

-- CreateIndex
CREATE INDEX "local_computer_sessions_spaceId_userId_connected_idx" ON "local_computer_sessions"("spaceId", "userId", "connected");

-- CreateIndex
CREATE INDEX "local_computer_sessions_computerId_idx" ON "local_computer_sessions"("computerId");

-- CreateIndex
CREATE INDEX "local_computer_commands_sessionId_status_createdAt_idx" ON "local_computer_commands"("sessionId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "local_devices" ADD CONSTRAINT "local_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_devices" ADD CONSTRAINT "local_devices_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_computer_sessions" ADD CONSTRAINT "local_computer_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "local_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_computer_sessions" ADD CONSTRAINT "local_computer_sessions_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_computer_sessions" ADD CONSTRAINT "local_computer_sessions_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_computer_commands" ADD CONSTRAINT "local_computer_commands_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "local_computer_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
