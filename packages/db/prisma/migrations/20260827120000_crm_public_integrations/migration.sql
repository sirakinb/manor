CREATE TABLE "integration_credentials" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "scopes" JSONB NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_idempotency_keys" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_contact_external_ids" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_contact_external_ids_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_webhook_endpoints" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "signingSecret" TEXT NOT NULL,
  "events" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_webhook_events" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "endpointId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_credentials_tokenHash_key" ON "integration_credentials"("tokenHash");
CREATE INDEX "integration_credentials_workspaceId_revokedAt_idx" ON "integration_credentials"("workspaceId", "revokedAt");
CREATE UNIQUE INDEX "integration_idempotency_keys_credentialId_key_key" ON "integration_idempotency_keys"("credentialId", "key");
CREATE INDEX "integration_idempotency_keys_expiresAt_idx" ON "integration_idempotency_keys"("expiresAt");
CREATE UNIQUE INDEX "crm_contact_external_ids_workspaceId_source_externalId_key" ON "crm_contact_external_ids"("workspaceId", "source", "externalId");
CREATE INDEX "crm_contact_external_ids_contactId_idx" ON "crm_contact_external_ids"("contactId");
CREATE INDEX "crm_webhook_endpoints_workspaceId_enabled_idx" ON "crm_webhook_endpoints"("workspaceId", "enabled");
CREATE INDEX "crm_webhook_events_workspaceId_createdAt_idx" ON "crm_webhook_events"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "crm_webhook_deliveries_endpointId_eventId_key" ON "crm_webhook_deliveries"("endpointId", "eventId");
CREATE INDEX "crm_webhook_deliveries_status_nextAttemptAt_idx" ON "crm_webhook_deliveries"("status", "nextAttemptAt");

ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_idempotency_keys" ADD CONSTRAINT "integration_idempotency_keys_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_idempotency_keys" ADD CONSTRAINT "integration_idempotency_keys_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "integration_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contact_external_ids" ADD CONSTRAINT "crm_contact_external_ids_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contact_external_ids" ADD CONSTRAINT "crm_contact_external_ids_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_events" ADD CONSTRAINT "crm_webhook_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_deliveries" ADD CONSTRAINT "crm_webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "crm_webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_deliveries" ADD CONSTRAINT "crm_webhook_deliveries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "crm_webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
