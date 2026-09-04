-- Load a Pentridge Agent Workspace export (see export-pentridge-workspace.sh)
-- into Manor's workspace_* tables under one organization.
--
-- Expects the CSVs already staged as all-text tables in schema pentridge_import
-- (the .sh wrapper does that) and these psql variables:
--   :org   organization id that owns the workspace
--   :name  display name for the workspace
--   :slug  workspace slug
--
-- Row ids are preserved so a second run can be compared against the source.
-- Timestamps are stored as UTC, which is what Prisma expects from timestamp(3).

\set ON_ERROR_STOP on
set client_min_messages to warning;
set timezone to 'UTC';

begin;

create or replace function pentridge_import.norm_street_addr(a text) returns text
language sql immutable as $$
  select trim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      lower(regexp_replace(coalesce(a, ''), '[.,]', '', 'g')),
      '\mst\M', 'street', 'g'), '\mave\M', 'avenue', 'g'), '\mrd\M', 'road', 'g'),
      '\mdr\M', 'drive', 'g'), '\mn\M', 'north', 'g'), '\ms\M', 'south', 'g'),
      '\me\M', 'east', 'g'), '\mw\M', 'west', 'g'),
    '\s+', ' ', 'g'))
$$;

-- The workspace row. Its id is the source workspace id.
insert into workspaces (
  id, "organizationId", name, slug, channels, "activityApproval",
  "monthlyVoiceReportsEnabled", "monthlyVoiceReportDay", "monthlyVoiceReportHour", "monthlyVoiceLastSentOn",
  "weeklyEmailReportsEnabled", "weeklyEmailReportDay", "weeklyEmailReportHour", "weeklyEmailLastSentOn",
  "reportRecipient", "reportReviewerEmail", "createdAt", "updatedAt")
select
  id, :'org', :'name', :'slug', channels::text[], activity_approval,
  monthly_reports_enabled::boolean, monthly_voice_report_day::int, monthly_voice_report_hour::int, monthly_voice_last_sent_on::date,
  weekly_email_reports_enabled::boolean, weekly_email_report_day::int, weekly_email_report_hour::int, weekly_email_last_sent_on::date,
  monthly_report_recipient, report_reviewer_email, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.workspaces;

insert into workspace_sources (id, "workspaceId", name, "sourceType", status, "connectionMethod", "lastSyncedAt", config, "createdAt", "updatedAt")
select id, workspace_id, source_name, source_type, status, connection_method, last_synced_at::timestamptz, config::jsonb, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.data_sources;

insert into workspace_sync_runs (id, "workspaceId", "sourceId", status, "startedAt", "finishedAt", "recordsLoaded", "errorMessage", metadata, "createdAt", "updatedAt")
select id, workspace_id, data_source_id, status, started_at::timestamptz, finished_at::timestamptz, records_loaded::int, error_message, metadata::jsonb, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.sync_runs;

insert into workspace_voice_calls (id, "workspaceId", "sourceCallId", "sourceSystem", "agentType", "callerName", "callerPhone", "callStartedAt", "durationSeconds", "callbackRequested", "aiResolved", "aiResolutionNotes", "recordingUrl", "sourceCreatedAt", raw, "createdAt", "updatedAt")
select id, workspace_id, source_call_id, source_system, agent_type, caller_name, caller_phone, call_started_at::timestamptz, duration_seconds::int, callback_requested::boolean, ai_resolved::boolean, ai_resolution_notes, recording_url, source_created_at::timestamptz, raw_json::jsonb, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.voice_calls;

insert into workspace_voice_transcripts (id, "workspaceId", "voiceCallId", "transcriptText", "speakerSegments", raw, "createdAt", "updatedAt")
select id, workspace_id, voice_call_id, transcript_text, speaker_segments::jsonb, raw_json::jsonb, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.voice_transcripts;

insert into workspace_voice_call_analyses (id, "workspaceId", "voiceCallId", summary, "callReason", sentiment, "followUpRequired", tags, raw, "createdAt", "updatedAt")
select id, workspace_id, voice_call_id, summary, call_reason, sentiment, follow_up_required::boolean, coalesce(tags::text[], '{}'), raw_json::jsonb, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.voice_call_analysis;

insert into workspace_reports (id, "workspaceId", "reportType", title, status, "dateRangeStart", "dateRangeEnd", "generatedBy", "generatedAt", summary, report, "shareToken", "editedAt", "editedBy", "approvedAt", "approvedBy", "sentAt", "sentTo", "reviewRemindedOn", "createdAt", "updatedAt")
select id, workspace_id, report_type, title, status, date_range_start::timestamptz, date_range_end::timestamptz, generated_by, generated_at::timestamptz, summary, report_json::jsonb, share_token, edited_at::timestamptz, edited_by, approved_at::timestamptz, approved_by, sent_at::timestamptz, sent_to, review_reminded_on::date, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.reports;

insert into workspace_email_campaigns (id, "workspaceId", "sourceCampaignId", "campaignKey", name, subject, preheader, topic, "fromEmail", "senderName", "replyTo", status, "campaignType", "sentAt", "sourceCreatedAt", "emailsSent", delivered, opens, unopened, "uniqueClicks", bounces, "hardBounces", "softBounces", unsubscribes, spam, complaints, forwards, "deliveredPercent", "openPercent", "clickPercent", "clicksPerOpen", "bouncePercent", "unsubPercent", "useragentStats", "statsSyncedAt", "createdAt", "updatedAt")
select id, workspace_id, source_campaign_id, campaign_key, name, subject, preheader, topic, from_email, sender_name, reply_to, status, campaign_type, sent_at::timestamptz, source_created_at::timestamptz, emails_sent::int, delivered::int, opens::int, unopened::int, unique_clicks::int, bounces::int, hardbounces::int, softbounces::int, unsubscribes::int, spam::int, complaints::int, forwards::int, delivered_percent::float8, open_percent::float8, click_percent::float8, clicks_per_open::float8, bounce_percent::float8, unsub_percent::float8, useragent_stats::jsonb, stats_synced_at::timestamptz, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.email_campaigns;

insert into workspace_email_campaign_links (id, "workspaceId", "sourceCampaignId", url, "uniqueClickers", "totalClicks", "syncedAt")
select id, workspace_id, source_campaign_id, url, unique_clickers::int, total_clicks::int, synced_at::timestamptz
from pentridge_import.email_campaign_links;

insert into workspace_instagram_daily (id, "workspaceId", "igUserId", date, followers, follows, "mediaCount", reach, "newFollowers", "createdAt", "updatedAt")
select id, workspace_id, ig_user_id, date::date, followers::int, follows::int, media_count::int, reach::int, new_followers::int, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.social_instagram_daily;

insert into workspace_instagram_media (id, "workspaceId", "igUserId", "mediaId", "mediaType", caption, permalink, "thumbnailUrl", "postedAt", "likeCount", "commentsCount", reach, views, saved, shares, "totalInteractions", "statsSyncedAt", "createdAt", "updatedAt")
select id, workspace_id, ig_user_id, media_id, media_type, caption, permalink, thumbnail_url, posted_at::timestamptz, like_count::int, comments_count::int, reach::int, views::int, saved::int, shares::int, total_interactions::int, stats_synced_at::timestamptz, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.social_instagram_media;

insert into workspace_instagram_stats (id, "workspaceId", "igUserId", username, name, biography, "profilePictureUrl", followers, follows, "mediaCount", "reach28d", "profileViews28d", "accountsEngaged28d", "totalInteractions28d", demographics, "capturedAt", "updatedAt")
select id, workspace_id, ig_user_id, username, name, biography, profile_picture_url, followers::int, follows::int, media_count::int, reach_28d::int, profile_views_28d::int, accounts_engaged_28d::int, total_interactions_28d::int, demographics::jsonb, captured_at::timestamptz, updated_at::timestamptz
from pentridge_import.social_instagram_stats;

insert into workspace_buildium_applications (id, "workspaceId", "applicantId", "applicationId", "applicationNumber", status, "applicationStatus", "propertyId", "unitId", "tenantId", "submittedAt", "lastUpdated", "createdAt", "updatedAt")
select id, workspace_id, applicant_id::int, application_id::int, application_number, status, application_status, property_id::int, unit_id::int, tenant_id::int, submitted_at::timestamptz, last_updated::timestamptz, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.buildium_applications;

insert into workspace_buildium_leases (id, "workspaceId", "leaseId", "propertyId", "unitId", "unitNumber", status, "leaseType", "termType", "leaseFrom", "leaseTo", rent, "securityDeposit", "numberOfOccupants", "isEvictionPending", "sourceCreatedAt", "lastUpdated", "createdAt", "updatedAt")
select id, workspace_id, lease_id::int, property_id::int, unit_id::int, unit_number, status, lease_type, term_type, lease_from::date, lease_to::date, rent::float8, security_deposit::float8, number_of_occupants::int, is_eviction_pending::boolean, source_created_at::timestamptz, last_updated::timestamptz, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.buildium_leases;

insert into workspace_buildium_properties (id, "workspaceId", "propertyId", name, "addressLine", city, state, "postalCode", "isActive", "rentalType", "rentalSubType", "numberUnits", "yearBuilt", "structureDescription", "operatingBankAccountId", reserve, "rentalManager", "updatedAt")
select id, workspace_id, property_id::int, name, address_line, city, state, postal_code, is_active::boolean, rental_type, rental_sub_type, number_units::int, year_built::int, structure_description, operating_bank_account_id::int, reserve::float8, rental_manager, updated_at::timestamptz
from pentridge_import.buildium_properties;

insert into workspace_buildium_listings (id, "workspaceId", "unitId", "propertyId", "propertyName", "addressLine", city, state, "postalCode", "unitNumber", bedrooms, bathrooms, "unitSize", rent, deposit, "leaseTerms", "availableDate", "listingDate", "isSection8", "isManagedExternally", "applicationUrl", "createdAt", "updatedAt")
select id, workspace_id, unit_id::int, property_id::int, property_name, address_line, city, state, postal_code, unit_number, bedrooms, bathrooms, unit_size::int, rent::float8, deposit::float8, lease_terms, available_date::date, listing_date::date, is_section8::boolean, is_managed_externally::boolean, application_url, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.buildium_listings;

insert into workspace_buildium_units (id, "workspaceId", "unitId", "propertyId", "buildingName", "unitNumber", description, "marketRent", "addressLine", city, state, "postalCode", bedrooms, bathrooms, "unitSize", "isListed", "isOccupied", "updatedAt")
select id, workspace_id, unit_id::int, property_id::int, building_name, unit_number, description, market_rent::float8, address_line, city, state, postal_code, bedrooms, bathrooms, unit_size::int, is_listed::boolean, is_occupied::boolean, updated_at::timestamptz
from pentridge_import.buildium_units;

insert into workspace_buildium_files (id, "workspaceId", "fileId", "entityId", "entityType", "categoryId", title, description, "physicalFileName", "uploadedAt", "updatedAt")
select id, workspace_id, file_id::int, entity_id::int, entity_type, category_id::int, title, description, physical_file_name, uploaded_at::timestamptz, updated_at::timestamptz
from pentridge_import.buildium_files;

insert into workspace_rema_listings (id, "workspaceId", "listableUid", title, "streetAddress", unit, "fullAddress", "streetNorm", rent, "bedBath", available, "detailUrl", "isSection8", "scrapedAt", "createdAt", "updatedAt")
select id, workspace_id, listable_uid, title, street_address, unit, full_address, pentridge_import.norm_street_addr(street_address), rent::float8, bed_bath, available, detail_url, is_section8::boolean, scraped_at::timestamptz, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.rema_listings;

insert into workspace_sheet_listings (id, "workspaceId", "rawName", "streetAddress", "streetNorm", "unitNote", "rentText", rent, "isSection8", beds, baths, "scrapedAt", "createdAt")
select id, workspace_id, raw_name, street_address, pentridge_import.norm_street_addr(street_address), unit_note, rent_text, rent::float8, is_section8::boolean, beds, baths, scraped_at::timestamptz, created_at::timestamptz
from pentridge_import.sheet_listings;

insert into workspace_utility_properties (id, "workspaceId", utility, address, "addressNorm", "billingMode", "propertyId", active, "splitEvenly", notes, "createdAt", "updatedAt")
select id, workspace_id, utility, address, pentridge_import.norm_street_addr(address), billing_mode, property_id::int, active::boolean, split_evenly::boolean, notes, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.utility_properties;

insert into workspace_water_bills (id, "workspaceId", utility, "gmailMessageId", "billIndex", "receivedAt", "sourceSender", "serviceAddress", "serviceAddressNorm", "accountBalance", "amountDue", "dueDate", "billingMonth", "parseStatus", "parseNotes", "rawSnippet", "createdAt")
select id, workspace_id, utility, gmail_message_id, bill_index::int, received_at::timestamptz, source_sender, service_address, pentridge_import.norm_street_addr(service_address), account_balance::float8, amount_due::float8, due_date::date, date_trunc('month', due_date::date)::date, parse_status, parse_notes, raw_snippet, created_at::timestamptz
from pentridge_import.water_bills;

insert into workspace_water_bill_charge_posts (id, "workspaceId", "waterBillId", "leaseId", amount, memo, "glAccountId", status, "buildiumChargeId", error, "postedAt", "postedBy", "createdAt", "updatedAt")
select id, workspace_id, water_bill_id, lease_id::int, amount::float8, memo, gl_account_id::int, status, buildium_charge_id::int, error, posted_at::timestamptz, posted_by, coalesce(updated_at::timestamptz, now()), coalesce(updated_at::timestamptz, now())
from pentridge_import.water_bill_charge_posts;

insert into workspace_activities (id, "workspaceId", channel, kind, title, summary, payload, status, actor, verification, "verifiedBy", "verifiedAt", "idempotencyKey", "createdAt", "updatedAt")
select id, workspace_id, channel, kind, title, summary, payload::jsonb, status, actor, verification, verified_by, verified_at::timestamptz, idempotency_key, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.activities;

insert into workspace_skills (id, "workspaceId", name, kind, version, content, notes, "createdBy", "createdAt")
select id, workspace_id, name, kind, version::int, content, notes, created_by, created_at::timestamptz
from pentridge_import.workspace_skills;

insert into workspace_context (id, "workspaceId", key, content, "updatedBy", "createdAt", "updatedAt")
select id, workspace_id, key, content, updated_by, created_at::timestamptz, updated_at::timestamptz
from pentridge_import.workspace_context;

drop schema pentridge_import cascade;

commit;
