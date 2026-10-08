#!/usr/bin/env bash
# One-command Manor install for a fresh Ubuntu or Debian VPS, served through a Cloudflare Tunnel.
#
#   curl -fsSL https://raw.githubusercontent.com/sirakinb/manor/main/infra/compose/install-vps.sh | sudo bash
#
# Asks for a hostname, the owner's email, and a Cloudflare Tunnel token, then installs Docker if
# needed, writes /opt/manor/.env, firewalls agent computers, starts the stack, and installs the
# `manor` command for updates. Rerunning keeps the existing .env and data.
#
# Non-interactive: set MANOR_HOST, MANOR_OWNER_EMAIL, and CLOUDFLARE_TUNNEL_TOKEN beforehand.
# Optional: MANOR_DIR (default /opt/manor), MANOR_IMAGE_TAG (default latest), RAKAZO_DOWNLOAD_BASE.

set -Eeuo pipefail

DOWNLOAD_BASE="${RAKAZO_DOWNLOAD_BASE:-https://raw.githubusercontent.com/sirakinb/manor/main/infra/compose}"
DOWNLOAD_BASE="${DOWNLOAD_BASE%/}"
MANOR_DIR="${MANOR_DIR:-/opt/manor}"
IMAGE_TAG="${MANOR_IMAGE_TAG:-latest}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() {
  echo "Manor setup failed: $*" >&2
  exit 1
}

case "$DOWNLOAD_BASE" in
  https://*) ;;
  *) fail "RAKAZO_DOWNLOAD_BASE must use https." ;;
esac

# `curl | bash` gives the script's stdin to bash, so questions read from the terminal directly.
# Opening /dev/tty fails when there is no controlling terminal (an agent or CI), even if it exists.
has_tty() { { : </dev/tty; } 2>/dev/null; }

ask() {
  local prompt="$1" answer=""
  has_tty || fail "no terminal to ask '${prompt}'. Set the MANOR_* variables instead."
  read -r -p "$prompt " answer </dev/tty
  printf '%s' "$answer"
}

ask_secret() {
  local prompt="$1" answer=""
  has_tty || fail "no terminal to ask '${prompt}'. Set the MANOR_* variables instead."
  read -r -s -p "$prompt " answer </dev/tty
  echo >/dev/tty
  printf '%s' "$answer"
}

# Replace KEY=... in .env, or append it. Values are written literally.
set_env() {
  local key="$1" value="$2" file="$MANOR_DIR/.env" tmp
  tmp=$(mktemp "$MANOR_DIR/.env.tmp.XXXXXX")
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file" >"$tmp"
  chmod 600 "$tmp"
  mv -- "$tmp" "$file"
}

# --- Checks -----------------------------------------------------------------------------------

[[ "$(id -u)" -eq 0 ]] || fail "run as root, for example: curl -fsSL … | sudo bash"
[[ "$(uname -s)" == "Linux" ]] || fail "this installer is for a Linux VPS."
[[ -r /etc/os-release ]] && . /etc/os-release
case "${ID:-}" in
  ubuntu | debian) ;;
  *) echo "Warning: tested on Ubuntu and Debian; continuing on ${ID:-an unknown system}." ;;
esac

case "$(uname -m)" in
  x86_64 | amd64 | aarch64 | arm64) ;;
  *) fail "unsupported CPU architecture $(uname -m)." ;;
esac
if [[ "$IMAGE_TAG" == "edge" && "$(uname -m)" != "x86_64" ]]; then
  fail "the edge images are x86 only. Use a release tag (the default) on ARM."
fi

memory_mb=$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)
if ((memory_mb < 3500)); then
  fail "Manor needs at least 4 GB of RAM (this server has ${memory_mb} MB). 8 GB is recommended."
elif ((memory_mb < 7500)); then
  echo "Note: ${memory_mb} MB of RAM works for a trial. 8 GB is recommended for regular use."
fi

mkdir -p "$MANOR_DIR"
disk_gb=$(df -Pk "$MANOR_DIR" | awk 'NR == 2 { print int($4 / 1048576) }')
((disk_gb >= 20)) || fail "Manor needs at least 20 GB of free disk (found ${disk_gb} GB)."

# --- Questions --------------------------------------------------------------------------------

say "Manor setup"
echo "You need a domain on Cloudflare and a tunnel token. The guide shows where to get one."

host="${MANOR_HOST:-}"
while [[ -z "$host" ]]; do
  host=$(ask "Hostname for Manor (for example manor.example.com):")
done
host="${host#https://}"
host="${host#http://}"
host="${host%%/*}"
[[ "$host" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail "'${host}' is not a hostname."

owner_email="${MANOR_OWNER_EMAIL:-}"
while [[ ! "$owner_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; do
  owner_email=$(ask "Your email (only this address can create the first account):")
done

tunnel_token="${CLOUDFLARE_TUNNEL_TOKEN:-}"
while [[ -z "$tunnel_token" ]]; do
  tunnel_token=$(ask_secret "Cloudflare Tunnel token (input hidden):")
  # People often paste the whole `cloudflared service install <token>` command.
  tunnel_token="${tunnel_token##* }"
done

# --- Docker -----------------------------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker"
  command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl; }
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
command -v openssl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq openssl; }
command -v iptables >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq iptables; }

# --- Configuration ----------------------------------------------------------------------------

say "Preparing ${MANOR_DIR}"
cd "$MANOR_DIR"
curl -fsSL --proto-redir =https "$DOWNLOAD_BASE/install-images.sh" -o install-images.sh
curl -fsSL --proto-redir =https "$DOWNLOAD_BASE/harden-computer-egress.sh" -o harden-computer-egress.sh
RAKAZO_DOWNLOAD_BASE="$DOWNLOAD_BASE" bash install-images.sh --prepare-only

origin="https://${host}"
set_env BETTER_AUTH_URL "$origin"
set_env WEB_ORIGIN "$origin"
set_env API_URL "$origin"
set_env RAKAZO_HOST "$host"
set_env SIGNUP_ALLOWLIST "$owner_email"
set_env COMPOSE_PROFILES tunnel
set_env CLOUDFLARE_TUNNEL_TOKEN "$tunnel_token"
set_env RAKAZO_IMAGE_TAG "$IMAGE_TAG"
set_env RAKAZO_COMPUTER_IMAGE_TAG "$IMAGE_TAG"

# --- Agent computer firewall ------------------------------------------------------------------

say "Firewalling agent computers"
install -m 0755 harden-computer-egress.sh /usr/local/sbin/rakazo-computer-egress
cat >/etc/systemd/system/rakazo-computer-egress.service <<'UNIT'
[Unit]
Description=Apply egress and isolation rules for Manor agent computers
Requires=docker.service
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=COMPUTER_BRIDGE=mnrc
ExecStart=/usr/local/sbin/rakazo-computer-egress

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable rakazo-computer-egress.service >/dev/null
systemctl restart rakazo-computer-egress.service

# --- manor command ----------------------------------------------------------------------------

cat >/usr/local/bin/manor <<MANOR
#!/usr/bin/env bash
set -euo pipefail
cd "$MANOR_DIR"
compose() { docker compose --env-file .env -f docker-compose.images.yml "\$@"; }
case "\${1:-}" in
  update) compose pull && compose up -d --remove-orphans && docker image prune -f >/dev/null ;;
  status) compose ps ;;
  logs) shift; compose logs --tail 200 -f "\$@" ;;
  restart) compose up -d --force-recreate ;;
  stop) compose down ;;
  start) compose up -d ;;
  *) echo "Usage: manor update | status | logs [service] | restart | stop | start" >&2; exit 2 ;;
esac
MANOR
chmod 0755 /usr/local/bin/manor

# --- Start ------------------------------------------------------------------------------------

say "Starting Manor (the first download takes a few minutes)"
bash install-images.sh --local

healthy=false
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:3100/health >/dev/null 2>&1 &&
    curl -fsS -H "Host: ${host}" http://127.0.0.1:5173/ >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 5
done

if [[ "$healthy" != true ]]; then
  echo "Manor did not report healthy within 7 minutes. Check: manor status, then manor logs api" >&2
  exit 1
fi

say "Manor is running"
cat <<DONE
Open ${origin} and sign up with ${owner_email}. That account owns this server.

If the page does not load, check that your tunnel's public hostname points to http://web:5173.

Manage it with:  manor update | status | logs | restart
Settings live in ${MANOR_DIR}/.env (run 'manor restart' after editing).
DONE
