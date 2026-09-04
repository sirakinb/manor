-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "activityApproval" TEXT NOT NULL DEFAULT 'manual',
    "monthlyVoiceReportsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlyVoiceReportDay" INTEGER NOT NULL DEFAULT 0,
    "monthlyVoiceReportHour" INTEGER NOT NULL DEFAULT 9,
    "monthlyVoiceLastSentOn" DATE,
    "weeklyEmailReportsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weeklyEmailReportDay" INTEGER NOT NULL DEFAULT 1,
    "weeklyEmailReportHour" INTEGER NOT NULL DEFAULT 9,
    "weeklyEmailLastSentOn" DATE,
    "reportRecipient" TEXT,
    "reportReviewerEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_sources" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "connectionMethod" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_sync_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsLoaded" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_voice_calls" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceCallId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'retell',
    "agentType" TEXT NOT NULL DEFAULT 'tenant',
    "callerName" TEXT,
    "callerPhone" TEXT,
    "callStartedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "callbackRequested" BOOLEAN,
    "aiResolved" BOOLEAN,
    "aiResolutionNotes" TEXT,
    "recordingUrl" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_voice_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_voice_transcripts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "voiceCallId" TEXT NOT NULL,
    "transcriptText" TEXT,
    "speakerSegments" JSONB,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_voice_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_voice_call_analyses" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "voiceCallId" TEXT NOT NULL,
    "summary" TEXT,
    "callReason" TEXT,
    "sentiment" TEXT,
    "followUpRequired" BOOLEAN,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_voice_call_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_reports" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "generatedBy" TEXT,
    "generatedAt" TIMESTAMP(3),
    "summary" TEXT,
    "report" JSONB NOT NULL DEFAULT '{}',
    "shareToken" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "editedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "reviewRemindedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_email_campaigns" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceCampaignId" TEXT NOT NULL,
    "campaignKey" TEXT,
    "name" TEXT,
    "subject" TEXT,
    "preheader" TEXT,
    "topic" TEXT,
    "fromEmail" TEXT,
    "senderName" TEXT,
    "replyTo" TEXT,
    "status" TEXT,
    "campaignType" TEXT,
    "sentAt" TIMESTAMP(3),
    "sourceCreatedAt" TIMESTAMP(3),
    "emailsSent" INTEGER,
    "delivered" INTEGER,
    "opens" INTEGER,
    "unopened" INTEGER,
    "uniqueClicks" INTEGER,
    "bounces" INTEGER,
    "hardBounces" INTEGER,
    "softBounces" INTEGER,
    "unsubscribes" INTEGER,
    "spam" INTEGER,
    "complaints" INTEGER,
    "forwards" INTEGER,
    "deliveredPercent" DOUBLE PRECISION,
    "openPercent" DOUBLE PRECISION,
    "clickPercent" DOUBLE PRECISION,
    "clicksPerOpen" DOUBLE PRECISION,
    "bouncePercent" DOUBLE PRECISION,
    "unsubPercent" DOUBLE PRECISION,
    "useragentStats" JSONB,
    "statsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_email_campaign_links" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceCampaignId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uniqueClickers" INTEGER NOT NULL DEFAULT 0,
    "totalClicks" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_email_campaign_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_instagram_daily" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "followers" INTEGER,
    "follows" INTEGER,
    "mediaCount" INTEGER,
    "reach" INTEGER,
    "newFollowers" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_instagram_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_instagram_media" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "mediaType" TEXT,
    "caption" TEXT,
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "postedAt" TIMESTAMP(3),
    "likeCount" INTEGER,
    "commentsCount" INTEGER,
    "reach" INTEGER,
    "views" INTEGER,
    "saved" INTEGER,
    "shares" INTEGER,
    "totalInteractions" INTEGER,
    "statsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_instagram_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_instagram_stats" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "biography" TEXT,
    "profilePictureUrl" TEXT,
    "followers" INTEGER,
    "follows" INTEGER,
    "mediaCount" INTEGER,
    "reach28d" INTEGER,
    "profileViews28d" INTEGER,
    "accountsEngaged28d" INTEGER,
    "totalInteractions28d" INTEGER,
    "demographics" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_instagram_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_buildium_applications" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "applicantId" INTEGER NOT NULL,
    "applicationId" INTEGER,
    "applicationNumber" TEXT,
    "status" TEXT,
    "applicationStatus" TEXT,
    "propertyId" INTEGER,
    "unitId" INTEGER,
    "tenantId" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "lastUpdated" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_buildium_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_buildium_leases" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leaseId" INTEGER NOT NULL,
    "propertyId" INTEGER,
    "unitId" INTEGER,
    "unitNumber" TEXT,
    "status" TEXT,
    "leaseType" TEXT,
    "termType" TEXT,
    "leaseFrom" DATE,
    "leaseTo" DATE,
    "rent" DOUBLE PRECISION,
    "securityDeposit" DOUBLE PRECISION,
    "numberOfOccupants" INTEGER,
    "isEvictionPending" BOOLEAN,
    "sourceCreatedAt" TIMESTAMP(3),
    "lastUpdated" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_buildium_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_buildium_properties" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "name" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "isActive" BOOLEAN,
    "rentalType" TEXT,
    "rentalSubType" TEXT,
    "numberUnits" INTEGER,
    "yearBuilt" INTEGER,
    "structureDescription" TEXT,
    "operatingBankAccountId" INTEGER,
    "reserve" DOUBLE PRECISION,
    "rentalManager" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_buildium_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_buildium_listings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "unitId" INTEGER NOT NULL,
    "propertyId" INTEGER,
    "propertyName" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "unitNumber" TEXT,
    "bedrooms" TEXT,
    "bathrooms" TEXT,
    "unitSize" INTEGER,
    "rent" DOUBLE PRECISION,
    "deposit" DOUBLE PRECISION,
    "leaseTerms" TEXT,
    "availableDate" DATE,
    "listingDate" DATE,
    "isSection8" BOOLEAN,
    "isManagedExternally" BOOLEAN,
    "applicationUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_buildium_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_buildium_units" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "unitId" INTEGER NOT NULL,
    "propertyId" INTEGER,
    "buildingName" TEXT,
    "unitNumber" TEXT,
    "description" TEXT,
    "marketRent" DOUBLE PRECISION,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "bedrooms" TEXT,
    "bathrooms" TEXT,
    "unitSize" INTEGER,
    "isListed" BOOLEAN,
    "isOccupied" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_buildium_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_buildium_files" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileId" INTEGER NOT NULL,
    "entityId" INTEGER,
    "entityType" TEXT,
    "categoryId" INTEGER,
    "title" TEXT,
    "description" TEXT,
    "physicalFileName" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_buildium_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_rema_listings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "listableUid" TEXT NOT NULL,
    "title" TEXT,
    "streetAddress" TEXT NOT NULL,
    "unit" TEXT,
    "fullAddress" TEXT NOT NULL,
    "streetNorm" TEXT NOT NULL,
    "rent" DOUBLE PRECISION,
    "bedBath" TEXT,
    "available" TEXT,
    "detailUrl" TEXT NOT NULL,
    "isSection8" BOOLEAN NOT NULL DEFAULT false,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_rema_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_sheet_listings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "streetAddress" TEXT NOT NULL,
    "streetNorm" TEXT NOT NULL,
    "unitNote" TEXT,
    "rentText" TEXT,
    "rent" DOUBLE PRECISION,
    "isSection8" BOOLEAN NOT NULL DEFAULT false,
    "beds" TEXT,
    "baths" TEXT,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_sheet_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_utility_properties" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "utility" TEXT NOT NULL DEFAULT 'water',
    "address" TEXT NOT NULL,
    "addressNorm" TEXT NOT NULL,
    "billingMode" TEXT NOT NULL DEFAULT 'pass_through',
    "propertyId" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "splitEvenly" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_utility_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_water_bills" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "utility" TEXT NOT NULL DEFAULT 'water',
    "gmailMessageId" TEXT NOT NULL,
    "billIndex" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3),
    "sourceSender" TEXT,
    "serviceAddress" TEXT,
    "serviceAddressNorm" TEXT,
    "accountBalance" DOUBLE PRECISION,
    "amountDue" DOUBLE PRECISION,
    "dueDate" DATE,
    "billingMonth" DATE,
    "parseStatus" TEXT NOT NULL DEFAULT 'parsed',
    "parseNotes" TEXT,
    "rawSnippet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_water_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_water_bill_charge_posts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "waterBillId" TEXT NOT NULL,
    "leaseId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "memo" TEXT,
    "glAccountId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "buildiumChargeId" INTEGER,
    "error" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_water_bill_charge_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_activities" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "actor" TEXT NOT NULL,
    "verification" TEXT NOT NULL DEFAULT 'pending',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_skills" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'skill',
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_context" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_context_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_organizationId_key" ON "workspaces"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_sources_workspaceId_name_key" ON "workspace_sources"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "workspace_sync_runs_workspaceId_startedAt_idx" ON "workspace_sync_runs"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "workspace_sync_runs_sourceId_startedAt_idx" ON "workspace_sync_runs"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "workspace_voice_calls_workspaceId_callStartedAt_idx" ON "workspace_voice_calls"("workspaceId", "callStartedAt");

-- CreateIndex
CREATE INDEX "workspace_voice_calls_workspaceId_agentType_callStartedAt_idx" ON "workspace_voice_calls"("workspaceId", "agentType", "callStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_voice_calls_workspaceId_sourceCallId_key" ON "workspace_voice_calls"("workspaceId", "sourceCallId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_voice_transcripts_voiceCallId_key" ON "workspace_voice_transcripts"("voiceCallId");

-- CreateIndex
CREATE INDEX "workspace_voice_transcripts_workspaceId_idx" ON "workspace_voice_transcripts"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_voice_call_analyses_voiceCallId_key" ON "workspace_voice_call_analyses"("voiceCallId");

-- CreateIndex
CREATE INDEX "workspace_voice_call_analyses_workspaceId_idx" ON "workspace_voice_call_analyses"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_reports_shareToken_key" ON "workspace_reports"("shareToken");

-- CreateIndex
CREATE INDEX "workspace_reports_workspaceId_reportType_createdAt_idx" ON "workspace_reports"("workspaceId", "reportType", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_reports_workspaceId_approvedAt_idx" ON "workspace_reports"("workspaceId", "approvedAt");

-- CreateIndex
CREATE INDEX "workspace_email_campaigns_workspaceId_sentAt_idx" ON "workspace_email_campaigns"("workspaceId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_email_campaigns_workspaceId_sourceCampaignId_key" ON "workspace_email_campaigns"("workspaceId", "sourceCampaignId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_email_campaign_links_workspaceId_sourceCampaignId_key" ON "workspace_email_campaign_links"("workspaceId", "sourceCampaignId", "url");

-- CreateIndex
CREATE INDEX "workspace_instagram_daily_workspaceId_date_idx" ON "workspace_instagram_daily"("workspaceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_instagram_daily_workspaceId_igUserId_date_key" ON "workspace_instagram_daily"("workspaceId", "igUserId", "date");

-- CreateIndex
CREATE INDEX "workspace_instagram_media_workspaceId_postedAt_idx" ON "workspace_instagram_media"("workspaceId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_instagram_media_workspaceId_mediaId_key" ON "workspace_instagram_media"("workspaceId", "mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_instagram_stats_workspaceId_igUserId_key" ON "workspace_instagram_stats"("workspaceId", "igUserId");

-- CreateIndex
CREATE INDEX "workspace_buildium_applications_workspaceId_submittedAt_idx" ON "workspace_buildium_applications"("workspaceId", "submittedAt");

-- CreateIndex
CREATE INDEX "workspace_buildium_applications_workspaceId_status_idx" ON "workspace_buildium_applications"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_buildium_applications_workspaceId_applicantId_key" ON "workspace_buildium_applications"("workspaceId", "applicantId");

-- CreateIndex
CREATE INDEX "workspace_buildium_leases_workspaceId_status_idx" ON "workspace_buildium_leases"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "workspace_buildium_leases_workspaceId_leaseTo_idx" ON "workspace_buildium_leases"("workspaceId", "leaseTo");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_buildium_leases_workspaceId_leaseId_key" ON "workspace_buildium_leases"("workspaceId", "leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_buildium_properties_workspaceId_propertyId_key" ON "workspace_buildium_properties"("workspaceId", "propertyId");

-- CreateIndex
CREATE INDEX "workspace_buildium_listings_workspaceId_isSection8_idx" ON "workspace_buildium_listings"("workspaceId", "isSection8");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_buildium_listings_workspaceId_unitId_key" ON "workspace_buildium_listings"("workspaceId", "unitId");

-- CreateIndex
CREATE INDEX "workspace_buildium_units_workspaceId_propertyId_idx" ON "workspace_buildium_units"("workspaceId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_buildium_units_workspaceId_unitId_key" ON "workspace_buildium_units"("workspaceId", "unitId");

-- CreateIndex
CREATE INDEX "workspace_buildium_files_workspaceId_entityType_entityId_idx" ON "workspace_buildium_files"("workspaceId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "workspace_buildium_files_workspaceId_uploadedAt_idx" ON "workspace_buildium_files"("workspaceId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_buildium_files_workspaceId_fileId_key" ON "workspace_buildium_files"("workspaceId", "fileId");

-- CreateIndex
CREATE INDEX "workspace_rema_listings_workspaceId_streetNorm_idx" ON "workspace_rema_listings"("workspaceId", "streetNorm");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_rema_listings_workspaceId_listableUid_key" ON "workspace_rema_listings"("workspaceId", "listableUid");

-- CreateIndex
CREATE INDEX "workspace_sheet_listings_workspaceId_streetNorm_idx" ON "workspace_sheet_listings"("workspaceId", "streetNorm");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_sheet_listings_workspaceId_rawName_key" ON "workspace_sheet_listings"("workspaceId", "rawName");

-- CreateIndex
CREATE INDEX "workspace_utility_properties_workspaceId_utility_addressNor_idx" ON "workspace_utility_properties"("workspaceId", "utility", "addressNorm");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_utility_properties_workspaceId_utility_address_key" ON "workspace_utility_properties"("workspaceId", "utility", "address");

-- CreateIndex
CREATE INDEX "workspace_water_bills_workspaceId_serviceAddressNorm_idx" ON "workspace_water_bills"("workspaceId", "serviceAddressNorm");

-- CreateIndex
CREATE INDEX "workspace_water_bills_workspaceId_billingMonth_idx" ON "workspace_water_bills"("workspaceId", "billingMonth");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_water_bills_workspaceId_gmailMessageId_billIndex_key" ON "workspace_water_bills"("workspaceId", "gmailMessageId", "billIndex");

-- CreateIndex
CREATE INDEX "workspace_water_bill_charge_posts_workspaceId_status_idx" ON "workspace_water_bill_charge_posts"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_water_bill_charge_posts_waterBillId_leaseId_key" ON "workspace_water_bill_charge_posts"("waterBillId", "leaseId");

-- CreateIndex
CREATE INDEX "workspace_activities_workspaceId_createdAt_idx" ON "workspace_activities"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_activities_workspaceId_channel_createdAt_idx" ON "workspace_activities"("workspaceId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_activities_workspaceId_verification_idx" ON "workspace_activities"("workspaceId", "verification");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_activities_workspaceId_idempotencyKey_key" ON "workspace_activities"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "workspace_skills_workspaceId_name_idx" ON "workspace_skills"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_skills_workspaceId_name_version_key" ON "workspace_skills"("workspaceId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_context_workspaceId_key_key" ON "workspace_context"("workspaceId", "key");

-- RenameForeignKey
ALTER TABLE "integration_credentials" RENAME CONSTRAINT "integration_credentials_space_fkey" TO "integration_credentials_spaceId_fkey";

-- RenameForeignKey
ALTER TABLE "integration_idempotency_keys" RENAME CONSTRAINT "integration_idempotency_keys_space_fkey" TO "integration_idempotency_keys_spaceId_fkey";

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_sources" ADD CONSTRAINT "workspace_sources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_sync_runs" ADD CONSTRAINT "workspace_sync_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_sync_runs" ADD CONSTRAINT "workspace_sync_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "workspace_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_voice_calls" ADD CONSTRAINT "workspace_voice_calls_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_voice_transcripts" ADD CONSTRAINT "workspace_voice_transcripts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_voice_transcripts" ADD CONSTRAINT "workspace_voice_transcripts_voiceCallId_fkey" FOREIGN KEY ("voiceCallId") REFERENCES "workspace_voice_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_voice_call_analyses" ADD CONSTRAINT "workspace_voice_call_analyses_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_voice_call_analyses" ADD CONSTRAINT "workspace_voice_call_analyses_voiceCallId_fkey" FOREIGN KEY ("voiceCallId") REFERENCES "workspace_voice_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_reports" ADD CONSTRAINT "workspace_reports_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_email_campaigns" ADD CONSTRAINT "workspace_email_campaigns_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_email_campaign_links" ADD CONSTRAINT "workspace_email_campaign_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_instagram_daily" ADD CONSTRAINT "workspace_instagram_daily_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_instagram_media" ADD CONSTRAINT "workspace_instagram_media_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_instagram_stats" ADD CONSTRAINT "workspace_instagram_stats_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_buildium_applications" ADD CONSTRAINT "workspace_buildium_applications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_buildium_leases" ADD CONSTRAINT "workspace_buildium_leases_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_buildium_properties" ADD CONSTRAINT "workspace_buildium_properties_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_buildium_listings" ADD CONSTRAINT "workspace_buildium_listings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_buildium_units" ADD CONSTRAINT "workspace_buildium_units_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_buildium_files" ADD CONSTRAINT "workspace_buildium_files_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_rema_listings" ADD CONSTRAINT "workspace_rema_listings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_sheet_listings" ADD CONSTRAINT "workspace_sheet_listings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_utility_properties" ADD CONSTRAINT "workspace_utility_properties_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_water_bills" ADD CONSTRAINT "workspace_water_bills_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_water_bill_charge_posts" ADD CONSTRAINT "workspace_water_bill_charge_posts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_water_bill_charge_posts" ADD CONSTRAINT "workspace_water_bill_charge_posts_waterBillId_fkey" FOREIGN KEY ("waterBillId") REFERENCES "workspace_water_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_activities" ADD CONSTRAINT "workspace_activities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_skills" ADD CONSTRAINT "workspace_skills_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_context" ADD CONSTRAINT "workspace_context_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "integration_credentials_workspaceId_revokedAt_idx" RENAME TO "integration_credentials_spaceId_revokedAt_idx";
