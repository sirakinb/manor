#!/usr/bin/env bash
# Egress policy for agent computers.
#
# Agent computers run untrusted, model-generated activity. They need the public
# internet, but nothing on the private network: not the host's own services, not
# other containers, not the cloud metadata address. This installs idempotent
# iptables rules that allow internet egress and drop everything else.
#
# Required, not hardening-on-top: Manor pins every computer to one shared
# network, so the RFC1918 drop below is also what stops one bot from reaching
# another bot's unauthenticated VNC.
#
#   FORWARD (DOCKER-USER): computer subnet -> RFC1918 / link-local / loopback
#   INPUT:                 computer subnet -> the host itself
#
# Return traffic, the web container (which proxies screen streams into the
# computers), and the supervisor (which probes VNC readiness and proxies
# control streams since upstream sync #5) are allowed explicitly.
#
# Configure:
#   COMPUTER_SUBNET   CIDR of the computers' network (default 172.31.240.0/24)
#   SCREEN_PROXY_IPS  space-separated addresses allowed to open connections
#                     into it (default ".10 .11": web, supervisor)
#
# Rules live in memory and Docker rebuilds its chains on restart, so install
# infra/systemd/rakazo-computer-egress.service to reapply them. Setup steps are
# in infra/compose/VPS.md.
set -euo pipefail

COMPUTER_SUBNET="${COMPUTER_SUBNET:-172.31.240.0/24}"
SCREEN_PROXY_IPS="${SCREEN_PROXY_IPS:-172.31.240.10 172.31.240.11}"
PRIVATE_RANGES=(10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 127.0.0.0/8)
TAG="manor-computer-egress"

if ! iptables -L DOCKER-USER -n >/dev/null 2>&1; then
  echo "DOCKER-USER chain missing; is Docker running?" >&2
  exit 1
fi

# Remove any rules from a previous run so this script can be re-applied safely.
flush_tagged() {
  local chain="$1"
  while read -r rule; do
    [ -n "${rule}" ] || continue
    # shellcheck disable=SC2086
    iptables -D "${chain}" ${rule} 2>/dev/null || true
  done < <(iptables-save | awk -v c="${chain}" -v t="${TAG}" \
    '$0 ~ "-A "c && $0 ~ t { sub("^-A "c" ", ""); print }')
}

flush_tagged DOCKER-USER
flush_tagged INPUT

# --- FORWARD path: container -> other networks -------------------------------
pos=1
iptables -I DOCKER-USER "${pos}" -m conntrack --ctstate ESTABLISHED,RELATED \
  -m comment --comment "${TAG}" -j RETURN; pos=$((pos + 1))
for proxy_ip in ${SCREEN_PROXY_IPS}; do
  iptables -I DOCKER-USER "${pos}" -s "${proxy_ip}" \
    -m comment --comment "${TAG}" -j RETURN
  pos=$((pos + 1))
done
for range in "${PRIVATE_RANGES[@]}"; do
  iptables -I DOCKER-USER "${pos}" -s "${COMPUTER_SUBNET}" -d "${range}" \
    -m comment --comment "${TAG}" -j DROP
  pos=$((pos + 1))
done

# --- INPUT path: container -> the host's own addresses ------------------------
iptables -I INPUT 1 -s "${COMPUTER_SUBNET}" -m conntrack --ctstate ESTABLISHED,RELATED \
  -m comment --comment "${TAG}" -j ACCEPT
iptables -I INPUT 2 -s "${COMPUTER_SUBNET}" \
  -m comment --comment "${TAG}" -j DROP

echo "Applied ${TAG} rules for ${COMPUTER_SUBNET} (proxies allowed: ${SCREEN_PROXY_IPS})."
