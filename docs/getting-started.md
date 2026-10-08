# Getting started

From a fresh server to an agent doing real work, in about 30 minutes.

## 1. Install

You need a VPS (Ubuntu 24.04, 2 vCPU, 8 GB RAM, 40 GB disk) and a domain on Cloudflare.

**With a coding agent:** paste this into Claude Code, Codex, Cursor, or a similar agent:

```text
set up manor - https://manor.pentridgemedia.com/llms.txt
```

It asks for what it needs and runs the installer over SSH.

**By hand:** create a Cloudflare Tunnel and copy its token (Cloudflare dashboard → Zero Trust →
Networks → Tunnels → Create a tunnel). Give the tunnel a public hostname, such as
`manor.example.com`, that points at `http://web:5173`. Then, on the VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/sirakinb/manor/main/infra/compose/install-vps.sh | sudo bash
```

It asks for the hostname, your email, and the tunnel token. When it finishes, open your hostname.

## 2. Create your account

Sign up with the email you gave the installer. Only that address can create an account, and the
first account owns the server.

## 3. Connect a model

Manor runs on your own AI accounts. On **Connect a model**, either sign in with a subscription you
already have (ChatGPT Plus/Pro, Claude Pro/Max, GitHub Copilot, or SuperGrok) or paste an API key.
You can change this later from your name in the sidebar → **Models**.

## 4. Create your first agent

Give it a **Name**, a **Title** (its role, such as "Office manager"), and a **Description** of what
it's responsible for. The agent then introduces itself, asks what to focus on first, and suggests
apps to connect.

To add more agents later: **Create** → **New bot**.

## 5. Give it real work

Message the agent the way you would brief a new hire: what to do, where, and what done looks like.
Start with one small task you do every week.

- **Its computer:** each agent has its own browser and terminal. Open **Agent computer** to watch
  it work, or click **Take control** to step in.
- **Approvals:** before a consequential action, the agent asks. Choose **Allow once**, **Always
  allow this tool**, or **Deny**. Set what needs approval in **Settings** → **Advanced** →
  **Action confirmations**.
- **Website logins:** add them in the agent's settings under **Sign-in credentials** instead of
  pasting passwords into chat.

## 6. Make it a routine

Once a task works, ask the agent to repeat it, for example: "Do this every weekday at 8 AM
Eastern." You can also build routines yourself: **Agent computer** → **Routines** → **+**.
A routine runs **On a schedule** or from a **Webhook**, which lets a form or another tool kick it
off.

## 7. Connect your tools

Open **Integrations** in the sidebar to add apps such as Gmail or Slack, or to add your own tool
source: an MCP server, an OpenAPI document, or Treg.

## 8. Explore the rest

- **CRM:** contacts, pipeline, and signup forms your agents can work with.
- **Spaces:** **Create** → **New space** keeps agents, chats, and files for one area of your
  business together.
- **Your name in the sidebar:** **Settings** (including messaging channels such as text, Slack,
  WhatsApp, and Telegram), plus **Models**, **Memory**, **Voice**, and **Usage**.

## Running your server

On the VPS:

| Command | What it does |
| --- | --- |
| `manor update` | Install the latest release |
| `manor status` | Show what's running |
| `manor logs api` | Recent logs (also `web`, `worker`, `cloudflared`) |
| `manor restart` | Restart after editing settings |

Settings live in `/opt/manor/.env`. To let more people create accounts, add their emails to
`SIGNUP_ALLOWLIST` (comma-separated), then run `manor restart`. Inviting teammates into your
organization from the app isn't available yet.

Back up the database regularly, and copy the file off the server:

```bash
cd /opt/manor && docker compose --env-file .env -f docker-compose.images.yml exec -T postgres \
  pg_dump -U rakazo rakazo | gzip > manor-$(date +%F).sql.gz
```

## Getting help

Open an issue on [GitHub](https://github.com/sirakinb/manor/issues) with what you expected, what
happened, and any error you saw. Never post passwords, API keys, or tunnel tokens.
