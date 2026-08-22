# Deploy Manor to the cloud

This guide takes you from a cloned repo to your own always-on Manor instance,
running on a small server behind a Cloudflare Tunnel — the same setup
manor.pentridgemedia.com runs on. Expect 30–45 minutes end to end.

## What you need

| Thing | Cost | Notes |
|---|---|---|
| A VPS | ~$10–25/mo | Any provider (Hostinger, Hetzner, DigitalOcean…). Minimum 2 vCPU / 8 GB RAM / 100 GB disk, Ubuntu 24.04. Pick a "Docker" template if offered. |
| A domain | ~$10/yr | Any registrar. |
| A Cloudflare account | Free | Serves DNS and the tunnel. |

You do **not** need to pay for AI models — Manor is bring-your-own-key. Each
user connects their own subscription (ChatGPT Plus/Pro, Claude Pro/Max,
GitHub Copilot, SuperGrok) or an API key during onboarding.

## 1. Get the server ready

Create the VPS with Ubuntu 24.04. If your provider offers an "Ubuntu with
Docker" image, use it. Otherwise install Docker after first login:

```sh
curl -fsSL https://get.docker.com | sh
```

Confirm you have Docker 24+ and the compose plugin:

```sh
docker --version && docker compose version
```

## 2. Put your domain on Cloudflare

Add the domain to a free Cloudflare account and switch your registrar's
nameservers to the two Cloudflare gives you. (Propagation is usually minutes,
occasionally hours.)

## 3. Clone Manor onto the server

SSH into the VPS, then:

```sh
git clone https://github.com/sirakinb/manor.git /opt/manor
cd /opt/manor
```

## 4. Configure your instance

```sh
cp infra/compose/.env.vps.example .env.vps
```

Open `.env.vps` and fill in:

- `RAKAZO_HOST`, `BETTER_AUTH_URL`, `WEB_ORIGIN`, `API_URL` — your domain
  (e.g. `manor.example.com` / `https://manor.example.com`)
- `POSTGRES_PASSWORD` — `openssl rand -hex 24`
- `BETTER_AUTH_SECRET` — `openssl rand -base64 48`
- `ENCRYPTION_KEY` — `openssl rand -hex 32`
- `CLOUDFLARE_TUNNEL_TOKEN` — next step

## 5. Create the Cloudflare Tunnel

In Cloudflare: **Zero Trust → Networks → Tunnels → Create a tunnel**
(Cloudflared, remotely managed).

1. Copy the token from the connector install command (the long `eyJ…` string)
   into `CLOUDFLARE_TUNNEL_TOKEN` in `.env.vps`.
2. Under **Public hostname**, add your subdomain and domain, with service
   **HTTP** → `web:5173`.

That hostname mapping also creates the DNS record for you. The tunnel means
your server exposes **no open ports** and its IP stays hidden — Cloudflare is
the only way in.

## 6. Launch

```sh
docker compose --env-file .env.vps -f infra/compose/docker-compose.vps.yml up -d --build
```

The first build takes 10–20 minutes on a small VPS. It brings up Postgres,
the API (database migrations run automatically on boot), the worker, the web
app, the agent-computer supervisor, and the tunnel.

Check on it:

```sh
docker compose --env-file .env.vps -f infra/compose/docker-compose.vps.yml ps
```

When `api` shows `(healthy)`, open `https://your-domain` — you should see the
landing page.

## 7. Sign up, then lock the door

Create your account at your domain, connect a model subscription or API key
during onboarding, and create your first bot.

Then close signups to strangers — in `.env.vps` set:

```
SIGNUP_ALLOWLIST=you@example.com
```

(comma-separated to invite more people later), and restart the API:

```sh
docker compose --env-file .env.vps -f infra/compose/docker-compose.vps.yml up -d api
```

## Updating

```sh
cd /opt/manor
git pull
docker compose --env-file .env.vps -f infra/compose/docker-compose.vps.yml up -d --build
```

Migrations run automatically when the new API boots.

## Sizing and scaling

- A 2 vCPU / 8 GB VPS comfortably runs 1–3 users with 1–2 agent computers
  awake at once. Agent computers auto-sleep after 10 idle minutes
  (`SANDBOX_IDLE_MS`).
- More users? Upgrade the VPS (4 vCPU / 16 GB handles ~5–8 light users) — an
  in-place plan upgrade at most providers.
- Heavy or bursty workloads can switch `SANDBOX_PROVIDER` to `e2b` or
  `daytona` to run agent computers on elastic sandbox infrastructure instead
  of your own box.

## Troubleshooting

- **Site unreachable** — `docker logs manor-prod-cloudflared-1`; you should
  see four `Registered tunnel connection` lines. Check the tunnel's public
  hostname points at `http://web:5173`.
- **403 from the web app** — the web server only accepts your configured
  hostname (`RAKAZO_HOST`). Make sure it matches your domain exactly.
- **API unhealthy** — `docker logs manor-prod-api-1`; the most common cause
  is a missing/short `BETTER_AUTH_SECRET` or `ENCRYPTION_KEY`.
- **Bot computers never start** — the supervisor needs the Docker socket;
  confirm `/var/run/docker.sock` exists and the `computer` image built
  (`docker images | grep rakazo/computer`).
