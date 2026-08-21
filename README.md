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

## Where it's headed

Manor is young and moving fast. On the bench right now:

- **Group chats with handoffs** — put several agents in one room, give them an objective instead of a task list, and let them pass the work between themselves
- **Event triggers** — agents that react the moment an email lands or a message arrives, not just on a schedule
- **Deep service-business integrations** — the systems your industry actually runs on, connected natively

The goal isn't a smarter chatbot. It's the first genuinely affordable back office.

## Under the hood

TypeScript end to end — React 19 + Vite on the web, Electron on desktop, Expo on mobile. Hono + oRPC APIs, PostgreSQL + Prisma, Graphile Worker for the always-on machinery, sandboxed agent computers on Docker (with E2B and Daytona as managed options), model access through Pi, and hundreds of app integrations through Composio.

## Run it yourself

You'll need Node.js 22+, pnpm 9, and Docker Desktop.

```bash
git clone https://github.com/sirakinb/manor.git
cd manor
cp .env.example .env
```

Set `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` to independent, long random values. Optionally set `OPENROUTER_API_KEY`, or connect a model subscription during onboarding.

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

For production deployment behind a Cloudflare Tunnel, see [`infra/compose/VPS.md`](./infra/compose/VPS.md).

## Lineage

Manor is built on [Rakazo](https://github.com/elie222/rakazo), an excellent open-source agent platform (Apache 2.0), and contributes improvements back upstream. Manor takes that foundation in its own direction: a hosted, opinionated platform aimed squarely at service businesses.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
