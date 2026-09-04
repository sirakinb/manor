#!/usr/bin/env bash
# Export one Pentridge Agent Workspace tenant as CSV files, ready for
# import-pentridge-workspace.sh. Read-only against the source database.
#
#   PENTRIDGE_DATABASE_URL=postgres://... \
#     packages/db/scripts/export-pentridge-workspace.sh <workspace-uuid> <out-dir>
#
# Only the tables Manor's Workspace keeps are exported; the rest of the source
# schema (auth, OAuth, chat, SEO, intake, ads) is retired with the old app.
set -euo pipefail

WS="${1:?workspace uuid}"
OUT="${2:?output directory}"
: "${PENTRIDGE_DATABASE_URL:?set PENTRIDGE_DATABASE_URL to the source Postgres URL}"

TABLES=(
  data_sources sync_runs
  voice_calls voice_transcripts voice_call_analysis
  reports
  email_campaigns email_campaign_links
  social_instagram_daily social_instagram_media social_instagram_stats
  buildium_applications buildium_leases buildium_properties buildium_listings buildium_units buildium_files
  rema_listings sheet_listings
  utility_properties water_bills water_bill_charge_posts
  activities workspace_skills workspace_context
)

mkdir -p "$OUT"
psql "$PENTRIDGE_DATABASE_URL" -qAtc "select 1 from workspaces where id = '$WS'" | grep -q 1 \
  || { echo "workspace $WS not found" >&2; exit 1; }

psql "$PENTRIDGE_DATABASE_URL" -qc "\\copy (select * from workspaces where id = '$WS') to '$OUT/workspaces.csv' csv header"
for t in "${TABLES[@]}"; do
  psql "$PENTRIDGE_DATABASE_URL" -qc "\\copy (select * from $t where workspace_id = '$WS') to '$OUT/$t.csv' csv header"
  printf '%-28s %8s rows\n' "$t" "$(psql "$PENTRIDGE_DATABASE_URL" -qAtc "select count(*) from $t where workspace_id = '$WS'")"
done
