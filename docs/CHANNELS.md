# Messaging channels

Text a bot and it works. A bridge posts an incoming message to Manor, the
message becomes a normal turn in that bot's thread — same memory, same tools,
same computer — and the bot replies through the same bridge.

The endpoint is generic: iMessage, Slack, and SMS gateways all speak to it the
same way. iMessage is the walkthrough below because it needs the most setup.

## How it fits together

```
iPhone ──iMessage──► Mac running BlueBubbles ──webhook──► Manor /api/channels/imessage/inbound
                                  ▲                                    │
                                  └────────── bot reply ◄──────────────┘
                                     send_channel_message tool
```

Manor runs on Linux; iMessage only exists on Apple hardware. A Mac has to sit in
the middle, and unlike most integrations an agent cannot drive it through a
browser — there is no iMessage web client. Options:

| Bridge | Cost | Notes |
|---|---|---|
| [BlueBubbles](https://bluebubbles.app) on your own Mac | free | Open source, REST + webhooks. A Mac mini makes it always-on. |
| Hosted API (Sendblue, LoopMessage) | per message | No Mac to run; a third party sees the messages. |

For customer-facing texting at scale, use SMS (Twilio) rather than consumer
iMessage — Apple's terms do not permit commercial bulk messaging, and this same
endpoint accepts an SMS bridge without changes.

## Configure Manor

```sh
CHANNEL_WEBHOOK_SECRET=$(openssl rand -hex 32)   # bridge -> Manor
CHANNEL_OUTBOUND_URL=http://your-bridge:1234/send
CHANNEL_OUTBOUND_TOKEN=...                       # Manor -> bridge
CHANNEL_ALLOWED_CHATS=                           # optional, see below
```

Restart the API afterwards. Without `CHANNEL_WEBHOOK_SECRET` the endpoint
returns 503, so channels are off until you turn them on.

## Inbound

```
POST /api/channels/<provider>/inbound
Authorization: Bearer $CHANNEL_WEBHOOK_SECRET
Content-Type: application/json

{
  "botId": "<bot to deliver to>",
  "chatId": "<conversation id in the channel>",
  "text": "check the overdue invoices and text me a summary",
  "from": "+15551234567",       // optional, shown to the agent
  "messageId": "<channel message id>"  // optional but recommended
}
```

Responds `{"ok": true, "runId": "..."}`. Pass `messageId` and a retrying bridge
cannot start the same work twice — it is used as the idempotency key.

Two things are deliberate:

- **The bot decides the tenant.** Workspace and user come from the bot row, never
  from the request body, so a compromised bridge cannot reach another tenant's
  data.
- **The origin is described to the agent**, so it knows which conversation to
  answer and with which provider.

## Outbound

The agent calls `send_channel_message` with `provider`, `chat_id`, and `text`.
Manor POSTs to `CHANNEL_OUTBOUND_URL`:

```json
{ "provider": "imessage", "chatId": "...", "text": "3 invoices overdue, oldest 41 days." }
```

with `Authorization: Bearer $CHANNEL_OUTBOUND_TOKEN` when configured.

### Restricting where a bot can message

`CHANNEL_ALLOWED_CHATS` is a comma-separated list of conversation ids the agent
is allowed to reach. When set, anything else is refused before the bridge is
called, and the agent is told why.

This is worth setting. An agent that reads untrusted content — a web page, an
inbound message — can be talked into replying somewhere new, and "somewhere new"
is the shape data exfiltration takes on a messaging channel. The allowlist is
deterministic: no wording in a message or a page can talk the agent past it.

## BlueBubbles setup sketch

1. Install BlueBubbles Server on a Mac signed into iMessage; grant Full Disk
   Access. Note its password/API key.
2. Point a webhook at `https://<your-manor-host>/api/channels/imessage/inbound`,
   sending `Authorization: Bearer $CHANNEL_WEBHOOK_SECRET` and a body shaped as
   above (BlueBubbles' `chats[0].guid` is the `chatId`, `guid` is the
   `messageId`). A small relay script is the usual way to reshape its payload.
3. Set `CHANNEL_OUTBOUND_URL` to the relay endpoint that calls BlueBubbles'
   send-message API.
4. Send yourself a test message and watch the bot's thread.

Keep the bridge off the public internet — reach it over a private network or a
Cloudflare Tunnel, as it can read and send your messages.
