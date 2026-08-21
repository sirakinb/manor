# Manor on the Hostinger VPS (srv1675098)

Production deployment of Manor to the existing Hostinger KVM 2 box
(2 vCPU / 8 GB / 100 GB, Ubuntu 24.04 + Docker), co-located with the
Hermes Agent and Traefik containers — neither is touched.

## Architecture

```
Cloudflare (manor.pentridgemedia.com, proxied CNAME -> tunnel)
  └─ cloudflared (container, egress-only — no host ports published)
       └─ web:5173  (vite preview; proxies /api, /rpc -> api:3100, /novnc -> computers)
            ├─ api:3100      (migrates DB on boot, then serves)
            ├─ worker        (graphile wakeups)
            ├─ supervisor:7091 (docker sandbox provider; /var/run/docker.sock)
            │    └─ rakazo-bot-* computers (sibling containers on the "app" network)
            └─ postgres:16   (internal-only "data" network)
```

- `SANDBOX_PROVIDER=docker`: the supervisor launches bot computers as sibling
  containers from `rakazo/computer:local`, joined to the compose `app` network
  (`SANDBOX_SCREEN_NETWORK=internal`) so web's noVNC proxy reaches them by
  container IP. Expect **1–2 concurrent computers** on 2 vCPU.
- No host ports are published; ingress is exclusively via Cloudflare Tunnel,
  so the box's Traefik (80/443) and Hermes are unaffected and the origin IP
  stays hidden.

## First deploy

1. Get the code onto the box (e.g. `/docker/manor/` — see deploy notes below).
2. `cp infra/compose/.env.vps.example .env.vps` at the repo root; fill in
   secrets (`openssl rand` commands are in the file's comments).
3. Create the tunnel: Cloudflare Zero Trust → Networks → Tunnels → Create
   (Cloudflared, remotely managed). Public hostname
   `manor.pentridgemedia.com` → service `http://web:5173`. Put the tunnel
   token in `.env.vps` as `CLOUDFLARE_TUNNEL_TOKEN`.
4. Build and start:
   ```sh
   docker compose --env-file .env.vps -f infra/compose/docker-compose.vps.yml up -d --build
   ```
5. Verify: `docker compose -f infra/compose/docker-compose.vps.yml ps` (api
   healthy), then https://manor.pentridgemedia.com.

## Updating

```sh
git pull
docker compose --env-file .env.vps -f infra/compose/docker-compose.vps.yml up -d --build
```

Prisma migrations run automatically when the api container boots.

## Notes

- Memory caps total ≈ 5.5 GB across services; bot computers are uncapped, so
  keep concurrency low (the box shares 8 GB with Hermes).
- The repo `.dockerignore` excludes `**/._*` (exFAT AppleDouble files) — do
  not build from a context that bypasses it.
- Backups: `pgdata` and `appdata` named volumes hold all state.
  `infra/compose/backup-prod.sh` can be adapted (project name `manor-prod`).
