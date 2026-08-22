# iMessage bridge

Text a bot from your phone; it replies in the same thread. Manor runs on Linux
and iMessage only exists on Apple hardware, so a Mac sits in the middle running
[BlueBubbles](https://bluebubbles.app) plus the small relay in this directory.

```
iPhone ──► Messages on the Mac ──► BlueBubbles ──webhook──► relay ──► Manor
                                                              ▲          │
                                                              └── /send ◄─┘
```

The relay is one dependency-free file (`relay.mjs`, Node 22+). It exists because
BlueBubbles' payloads and Manor's channel API don't line up, and because someone
has to decide which senders are allowed to command an agent.

## 1. BlueBubbles on the Mac

Install BlueBubbles Server, sign Messages in, and grant Full Disk Access. Note
the server password and confirm it answers on `http://127.0.0.1:1234`.

Use a Mac that stays awake — a Mac mini is the usual answer. On a laptop the
bridge is only alive while the lid is open.

## 2. Manor side

In Manor's env (`.env.vps` on a server deployment):

```sh
CHANNEL_WEBHOOK_SECRET=<openssl rand -hex 32>
CHANNEL_OUTBOUND_URL=https://<relay-hostname>/send
CHANNEL_OUTBOUND_TOKEN=<openssl rand -hex 32>
CHANNEL_ALLOWED_CHATS=            # optional; pin replies to known chats
```

Restart the API. You also need the id of the bot that should receive messages —
it is in the URL when that bot is open (`/app/<botId>`).

## 3. Run the relay

```sh
MANOR_URL=https://manor.example.com \
MANOR_BOT_ID=<botId> \
CHANNEL_WEBHOOK_SECRET=<same as Manor> \
CHANNEL_OUTBOUND_TOKEN=<same as Manor> \
BLUEBUBBLES_URL=http://127.0.0.1:1234 \
BLUEBUBBLES_PASSWORD=<server password> \
ALLOWED_SENDERS='+15551234567,you@example.com' \
node relay.mjs
```

It listens on `127.0.0.1:8787` only. To keep it running, wrap it in a `launchd`
plist or run it under `pm2`.

## 4. Connect the two directions

**BlueBubbles → relay.** In BlueBubbles' settings add a webhook pointing at
`http://127.0.0.1:8787/bluebubbles`, subscribed to new-message events.

**Manor → relay.** Manor lives on another machine, so the relay needs an address
it can reach. Either is fine:

- **Cloudflare Tunnel** on the Mac — same pattern Manor itself uses; gives you a
  hostname with no ports open. Point `CHANNEL_OUTBOUND_URL` at it.
- **Tailscale** — put the Mac and the server on one tailnet and use the tailnet
  address.

Do not expose port 8787 directly to the internet. The relay can read and send
your messages.

## 5. Try it

Text the Mac from your phone. You should see `inbound from … -> manor 200` in the
relay log and the message appear in the bot's thread. Ask it to reply and watch
for `outbound -> …`.

## Who can command the bot

`ALLOWED_SENDERS` is the important setting. Anyone able to text that Mac could
otherwise drive an agent holding your logins, so the relay refuses every sender
until you list the ones you trust. Phone numbers are compared by digits, so
formatting differences don't matter.

Two more controls worth knowing:

- `CHANNEL_ALLOWED_CHATS` in Manor restricts where a bot may send. An agent that
  reads untrusted content can be talked into replying somewhere new, which is
  what exfiltration looks like on a messaging channel; the allowlist refuses it
  deterministically.
- Inbound text is untrusted input. Treat a bot on this channel like any bot that
  reads the open web: narrow its charter, and keep high-value credentials on a
  different bot.

## Customer-facing messaging

Consumer iMessage is for you and your team. Apple's terms don't permit
commercial bulk messaging, and unofficial bridges risk the Apple ID being
flagged. For texting customers, point an SMS provider (Twilio) at the same
`/api/channels/sms/inbound` endpoint — no Mac required.
