#!/usr/bin/env bash
# Import a Pentridge Agent Workspace export into Manor under one organization.
#
#   DATABASE_URL=postgres://... packages/db/scripts/import-pentridge-workspace.sh \
#     --dir <csv-dir> --organization <org-id> --name "Jackson Rental Homes" --slug jackson [--replace]
#
# The CSV directory comes from export-pentridge-workspace.sh. With --replace an
# existing workspace with the same id is deleted first (cascades to every
# workspace_* row), which is how the cutover re-import refreshes the data.
set -euo pipefail

DIR="" ORG="" NAME="" SLUG="" REPLACE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --organization) ORG="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --replace) REPLACE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
: "${DIR:?--dir}" "${ORG:?--organization}" "${NAME:?--name}" "${SLUG:?--slug}"
: "${DATABASE_URL:?set DATABASE_URL to the Manor Postgres URL}"

HERE="$(cd "$(dirname "$0")" && pwd)"
WS_ID="$(tail -n +2 "$DIR/workspaces.csv" | cut -d, -f1)"
[ -n "$WS_ID" ] || { echo "workspaces.csv has no row" >&2; exit 1; }

psql "$DATABASE_URL" -qAtc "select 1 from organization where id = '$ORG'" | grep -q 1 \
  || { echo "organization $ORG not found" >&2; exit 1; }

if psql "$DATABASE_URL" -qAtc "select 1 from workspaces where id = '$WS_ID' or \"organizationId\" = '$ORG'" | grep -q 1; then
  if [ "$REPLACE" = 1 ]; then
    psql "$DATABASE_URL" -qc "delete from workspaces where id = '$WS_ID' or \"organizationId\" = '$ORG'"
  else
    echo "a workspace already exists for this id or organization; pass --replace to reload it" >&2
    exit 1
  fi
fi

# Stage every CSV as an all-text table; the SQL step casts into the real columns.
export PGOPTIONS="--client-min-messages=warning"
psql "$DATABASE_URL" -qc "drop schema if exists pentridge_import cascade; create schema pentridge_import"
for csv in "$DIR"/*.csv; do
  table="$(basename "$csv" .csv)"
  case "$table" in ._*) continue ;; esac # macOS AppleDouble files on exFAT
  cols="$(head -n 1 "$csv" | tr ',' '\n' | sed 's/.*/"&" text/' | paste -sd, -)"
  psql "$DATABASE_URL" -qc "create table pentridge_import.$table ($cols)"
  psql "$DATABASE_URL" -qc "\\copy pentridge_import.$table from '$csv' csv header"
done

psql "$DATABASE_URL" -q -v org="$ORG" -v name="$NAME" -v slug="$SLUG" -f "$HERE/import-pentridge-workspace.sql"

psql "$DATABASE_URL" -qAt <<SQL
select 'workspace ' || id || ' (' || name || ') for organization ' || "organizationId" from workspaces where id = '$WS_ID';
select rpad(t, 36) || count from (
  select 'voice calls' t, count(*) from workspace_voice_calls where "workspaceId" = '$WS_ID'
  union all select 'transcripts', count(*) from workspace_voice_transcripts where "workspaceId" = '$WS_ID'
  union all select 'analyses', count(*) from workspace_voice_call_analyses where "workspaceId" = '$WS_ID'
  union all select 'reports', count(*) from workspace_reports where "workspaceId" = '$WS_ID'
  union all select 'email campaigns', count(*) from workspace_email_campaigns where "workspaceId" = '$WS_ID'
  union all select 'instagram media', count(*) from workspace_instagram_media where "workspaceId" = '$WS_ID'
  union all select 'leases', count(*) from workspace_buildium_leases where "workspaceId" = '$WS_ID'
  union all select 'listings', count(*) from workspace_buildium_listings where "workspaceId" = '$WS_ID'
  union all select 'water bills', count(*) from workspace_water_bills where "workspaceId" = '$WS_ID'
  union all select 'activities', count(*) from workspace_activities where "workspaceId" = '$WS_ID'
  union all select 'skills', count(*) from workspace_skills where "workspaceId" = '$WS_ID'
) c;
SQL
