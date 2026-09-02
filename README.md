<p align="center">
  <img src="./apps/web/public/manor-mark.png" width="96" alt="Manor" />
</p>

<h1 align="center">Manor</h1>

<p align="center"><em>Your team of always-on AI agents that you can give real work to.</em></p>

<p align="center">by <a href="https://pentridgemedia.com">Pentridge</a></p>

---

## The problem with running a service business

If you run a service business — property management, a law practice, a med spa, a cleaning company, an agency — you already know the shape of the problem, because you live inside it.

You find the leads. You answer the phone. You write the follow-ups. You chase the invoices. You update the CRM, when you remember to. Every task in the business waits for the same person: you. Software was supposed to help, and instead it gave you eleven more tabs to check.

The tools never actually *did* the work. They just held the work until you got there.

## What Manor is

Manor is a different bet: instead of giving you another tool, it gives you **staff**.

Each agent in Manor is hired like an employee, not prompted like a chatbot. You give it a name, a role, and a charter — what it owns, what good work looks like, and where it must stop and ask you. Then it gets the thing no chatbot has ever had:

**Its own computer.**

A real one, in the cloud — with a browser, a terminal, files, and a desktop. Your agents sign into the same tools you use — email, calendars, CRMs, spreadsheets, the web — and use them the way a person does: clicking, typing, navigating, filing. When a login wall appears, the agent hands you the screen; you sign in once, and your whole staff is signed in.

And because the computers live in the cloud, **your agents keep working after you close your laptop.** Routines fire at 7am whether you're awake or not. The Friday close happens on Friday. Work stops waiting for you.

## How you build your staff

**Hire by writing a charter.** A role, its responsibilities, its boundaries — the same brief you'd give a new hire on day one. Agents that must ask about everything are useless; agents that never ask are dangerous. The charter is where you draw that line once, instead of worrying about it every day.

**Show it the work — once.** Open an agent's computer, hit *Teach a task*, and walk through the workflow while it watches. It saves what you did as a named skill. Attach a schedule, and something you used to grind through every week now happens every night without you.

**Let them build the team.** Agents can hire other agents. A coordinator can spin up a specialist for a lane of work, hand it a charter, and manage it — which is the moment one assistant quietly becomes a company.

**Bring the model you already pay for.** Manor doesn't sell you tokens. Connect the AI subscription you already have — ChatGPT Plus/Pro, Claude Pro/Max, GitHub Copilot, SuperGrok — or paste any API key. Your models, your spend, your data.

## Under the hood

TypeScript end to end — React 19 + Vite on the web, Electron on desktop, Expo on mobile. Hono + oRPC APIs, PostgreSQL + Prisma, Graphile Worker for the always-on machinery, sandboxed agent computers on Docker (with E2B and Daytona as managed options), model access through Pi, and hundreds of app integrations through Composio.

## Run it yourself

You'll need Node.js 22+, pnpm 9, and Docker Desktop.

```bash
git clone https://github.com/sirakinb/manor.git
cd manor
cp .env.example .env
```

Set `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, and `SCREEN_PROXY_SECRET` in `.env` to independent
long random values. Docker sandboxes also need a dedicated `SANDBOX_SUPERVISOR_TOKEN`. You can
also set `OPENROUTER_API_KEY`, or connect a supported model provider during onboarding.

Managed app catalogs are optional. Set `COMPOSIO_API_KEY` for Composio, or the
`PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, and `PIPEDREAM_PROJECT_ID` trio for Pipedream
Connect. Users can add an HTTPS MCP server, Treg endpoint, or OpenAPI JSON document from
**Integrations** without enabling either managed catalog. Connector credentials are encrypted on the
server and are never returned by the API.

Native Google Forms access is also optional. Enable the Google Forms API and Google Drive API in a
Google Cloud project, create an OAuth Web client, and authorize
`<WEB_ORIGIN>/api/auth/callback/google` as its redirect URI. Set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` on the API server. Manor requests only form editing, response reading, and
app-file Drive access; provider tokens are encrypted at rest.

Treg is usage-metered. Self-hosters supply their own Treg token; operators embedding Treg in a
hosted product should review [Treg's integration terms](https://treg.to/integrate.md), which require
a written agreement for hosted resale.

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173), create an account, connect a model, and create
your first bot.

That runs Manor locally. To put it in the cloud — your own always-on instance behind a Cloudflare Tunnel, like the one this repo was built for — follow the step-by-step guide in [`docs/DEPLOY.md`](./docs/DEPLOY.md). Three accounts (a ~$15/mo VPS, a domain, free Cloudflare), six steps, about 45 minutes.

### Self-host from published images

No clone or Node install required — you need Docker Engine, the Compose plugin, curl, and OpenSSL.
Manor tracks upstream's published images:

```bash
mkdir -p manor && cd manor &&
curl -fsSLO https://raw.githubusercontent.com/elie222/rakazo/main/infra/compose/install-images.sh &&
bash install-images.sh
```

The installer downloads the Compose files, creates `.env` with random secrets, and starts the stack.
It preserves an existing `.env` when rerun. Default image tag is `edge` (main builds,
`linux/amd64`); on arm64, pin `RAKAZO_IMAGE_TAG` to a release (`latest` / `vX.Y.Z`).

For deployment, provider selection, backups, and upgrades, see the
[self-hosting guide](./docs/self-host.md).

## Desktop and mobile

The Electron and Expo apps are clients of the same Manor API used by the web app.

With the development stack running, launch Electron with:

```bash
pnpm --filter @rakazo/desktop dev
```

On first run the desktop app asks whether to use the stack on this computer
(`http://127.0.0.1:5173`) or connect to an existing server. Public servers must use HTTPS; HTTP is
accepted only for loopback and private LAN addresses (not link-local). The app verifies the
server's health endpoint before saving, and later launches go straight to that instance.

Use **Change Server…** in the application menu to reconnect. Closing that window without
saving returns to the previous instance. For development automation, set `RAKAZO_WEB_URL` to point
the shell somewhere else without changing the saved instance, or `RAKAZO_FORCE_SETUP=1` to run
setup again.

## Web UI language

The web (and Electron-hosted) UI supports English, Deutsch, 한국어, Türkçe, हिन्दी,
Português (Brasil), and 简体中文. Change it under **Settings → Language**. The marketing
homepage (`apps/www`) is available in en/de/ko via footer language links (`/`, `/de/`,
`/ko/`); other marketing pages stay English.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
