#!/usr/bin/env bash
# Nightly backup for a Manor VPS deployment.
#
# Writes a verified local snapshot (Postgres dump + app data) and, when an
# rclone remote is configured, uploads an encrypted copy off-box.
#
# Configure with environment variables (all optional except where noted):
#   MANOR_DIR           repo checkout on the server   (default /docker/manor)
#   COMPOSE_FILE        compose file to talk to       (default infra/compose/docker-compose.vps.yml)
#   ENV_FILE            env file for compose          (default $MANOR_DIR/.env.vps)
#   BACKUP_ROOT         local snapshot directory      (default /var/backups/manor)
#   BACKUP_PASS_FILE    passphrase file for off-box encryption (default /root/.manor-backup-pass)
#   RCLONE_REMOTE       e.g. "r2:manor-backups" — leave unset for local-only backups
#   APPDATA_VOLUME      docker volume with /data       (default manor-prod_appdata)
#   RETAIN_LOCAL_DAYS   local snapshots to keep       (default 7)
#   RETAIN_REMOTE_DAYS  remote copies to keep         (default 30)
#
# Restore, briefly:
#   local:  pg_restore into the postgres container, untar appdata into /data
#   remote: rclone copy the .enc down, then
#           openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:<passfile>
set -euo pipefail

MANOR_DIR="${MANOR_DIR:-/docker/manor}"
COMPOSE_FILE="${COMPOSE_FILE:-${MANOR_DIR}/infra/compose/docker-compose.vps.yml}"
ENV_FILE="${ENV_FILE:-${MANOR_DIR}/.env.vps}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/manor}"
BACKUP_PASS_FILE="${BACKUP_PASS_FILE:-/root/.manor-backup-pass}"
APPDATA_VOLUME="${APPDATA_VOLUME:-manor-prod_appdata}"
RETAIN_LOCAL_DAYS="${RETAIN_LOCAL_DAYS:-7}"
RETAIN_REMOTE_DAYS="${RETAIN_REMOTE_DAYS:-30}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT_DIR="${BACKUP_ROOT}/${STAMP}"

install -d -m 700 "${BACKUP_ROOT}" "${SNAPSHOT_DIR}"

compose=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

# 1. Database — custom format so pg_restore can be selective.
"${compose[@]}" exec -T postgres sh -c \
  'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "${SNAPSHOT_DIR}/manor.dump"

# 2. Application data (bot homes, artifacts). Read straight from the Docker
# volume on the host: agent computers write files as other uids, and the app
# containers drop CAP_DAC_OVERRIDE so they cannot read them. Browser profiles
# are kept (they hold the bots' logged-in sessions); their caches are skipped.
APPDATA_MOUNT="$(docker volume inspect "${APPDATA_VOLUME}" --format '{{.Mountpoint}}')"
tar -czf - -C "${APPDATA_MOUNT}" \
  --exclude="./homes/*/.browser-profiles/*/DeferredBrowserMetrics" \
  --exclude="./homes/*/.browser-profiles/*/*/Cache" \
  --exclude="./homes/*/.browser-profiles/*/*/Code Cache" \
  --exclude="./homes/*/.browser-profiles/*/*/GPUCache" \
  --exclude="./homes/*/.browser-profiles/*/*/ShaderCache" \
  --exclude="./homes/*/.cache" \
  . > "${SNAPSHOT_DIR}/appdata.tgz"

# 3. Verify both artifacts actually parse before trusting them.
"${compose[@]}" exec -T postgres pg_restore --list < "${SNAPSHOT_DIR}/manor.dump" >/dev/null
tar -tzf "${SNAPSHOT_DIR}/appdata.tgz" >/dev/null

sha256sum "${SNAPSHOT_DIR}/manor.dump" "${SNAPSHOT_DIR}/appdata.tgz" \
  > "${SNAPSHOT_DIR}/SHA256SUMS"
chmod 600 "${SNAPSHOT_DIR}"/*

# 4. Off-box copy, encrypted. Skipped when RCLONE_REMOTE is unset.
if [ -n "${RCLONE_REMOTE:-}" ]; then
  if [ ! -s "${BACKUP_PASS_FILE}" ]; then
    echo "Missing or empty ${BACKUP_PASS_FILE}; refusing to upload unencrypted." >&2
    exit 1
  fi
  archive="${BACKUP_ROOT}/${STAMP}.tar.gz.enc"
  tar -czf - -C "${BACKUP_ROOT}" "${STAMP}" \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
        -pass "file:${BACKUP_PASS_FILE}" -out "${archive}"
  chmod 600 "${archive}"
  rclone copy "${archive}" "${RCLONE_REMOTE}/" --s3-no-check-bucket
  rm -f "${archive}"
  rclone delete "${RCLONE_REMOTE}/" --min-age "${RETAIN_REMOTE_DAYS}d" || true
fi

# 5. Rotate local snapshots. BACKUP_ROOT is resolved above so this cleanup can
# never expand to an unexpected path.
find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime "+$((RETAIN_LOCAL_DAYS - 1))" \
  -exec rm -rf -- {} +

echo "Verified Manor backup: ${SNAPSHOT_DIR}${RCLONE_REMOTE:+ (uploaded to ${RCLONE_REMOTE})}"
