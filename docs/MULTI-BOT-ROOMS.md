# Design: multi-bot rooms

Put several agents in one conversation, give them an objective instead of a task
list, and let them pass work between themselves — pulling you in only for
judgment calls.

Status: **proposal**. Nothing here is built.

## Why

Manor can already create a team. A bot can hire another bot with `spawn_bot`,
give it a charter, and archive it later. Team Computers let several bots work at
once on their own screens.

What it cannot do is let them *talk*. Every thread belongs to exactly one bot, so
coordination has to route through a person: you read what one bot produced, then
paste it to the next. The team exists; the room does not.

This is also the clearest gap against comparable products, where multi-agent
group chat with handoffs is the headline feature.

## What it should feel like

```
You:    Find 40 property managers in Westchester, then draft outreach.

@Scout  On it — pulling from LinkedIn and the CRM.
        [12 minutes later] 40 found, 10 high-signal. @Quill they're in
        /workspace/leads.csv, top ones flagged.

@Quill  Drafting 10 emails, one specific hook each. Drafts only.
        Done — /workspace/drafts/. @you two mention pricing, want me to
        hold those?

You:    Send the eight, hold the two.
```

Three properties matter: you gave an *objective*, the handoff happened without
you, and you were consulted only where judgment was needed.

## The shape of the change

The run model is already closer than it looks. `Run` carries `botId` **and**
`threadId` as separate columns, so several bots having runs against one thread is
already representable. Two things block it:

| Blocker | Today | Needed |
|---|---|---|
| `Thread.botId` | `String @unique` — one thread per bot | nullable, non-unique; a room has participants instead |
| `Message` author | `role` only ("user" / "bot") | `authorBotId` so a room can attribute each message |

Everything else — events, runs, attempts, the realtime stream, message paging —
works unchanged, because those are keyed on `threadId`.

### Schema

```prisma
model Thread {
  kind      String   @default("direct")   // "direct" | "room"
  botId     String?  @unique              // null for rooms
  name      String?                       // rooms get a name
  participants ThreadParticipant[]
}

model ThreadParticipant {
  threadId  String
  botId     String
  addedAt   DateTime @default(now())
  @@id([threadId, botId])
}

model Message {
  authorBotId String?   // null when the human wrote it
}
```

Additive: existing threads keep `kind: "direct"` and their `botId`, so every
current behaviour is untouched.

### Mentions

One rule does all the work:

> A message containing `@BotName` enqueues a run for that bot on this thread.

That single rule produces both features. When **you** write the mention it is
delegation; when **a bot** writes it in its reply, the same code path fires and
that is a handoff. Handoffs need no separate mechanism.

### What a bot sees

A bot woken in a room receives the room's recent messages with attribution
(`Scout: …`, `you: …`), plus its own charter and memory as usual. It answers as
itself; the reply is stored with its `authorBotId` and fans out to everyone
watching the room.

## The hard parts

These are the reasons this is a design doc and not a patch.

**Loops.** Scout mentions Quill, Quill mentions Scout, forever — burning model
spend the whole way. Mitigations: a per-message hop counter that a bot cannot
increase, a cap on bot-initiated mentions per human turn (say 10), and refusing a
mention that would re-wake a bot already running in this thread.

**Cost.** Every mention is a run, and a run is model spend. A room where four
bots chat freely can spend more in ten minutes than a person expects in a day.
The hop cap is the primary control; a per-room budget with a "paused, approve to
continue" state is the honest second one.

**Concurrency.** Two bots replying at once both append to the same thread.
Message `seq` is already allocated under a thread-row lock, so ordering is safe,
but the executor's assumption that one run owns a thread needs auditing —
particularly `clearThread` and the run-cancellation logic that currently cancels
"other queued runs for this bot".

**Context growth.** A busy room's history outgrows a window quickly. Start with
the existing compaction; rooms may later need per-bot relevance filtering rather
than the whole transcript.

**The shared computer.** Bots in a room will reach for the same Team Computer.
That already works — separate screens per bot, with a takeover lease — but a room
makes collisions common rather than rare, so the lease errors need to surface as
readable messages instead of failures.

## Phases

Each phase is shippable and useful alone.

**1 · Rooms exist (≈1 day).** Schema, create-a-room, add/remove participants, a
room view that shows attributed messages. No agent behaviour yet — you can talk
to several bots in one place and they answer when addressed.

**2 · Mentions (≈1 day).** `@BotName` enqueues that bot's run. Delegation works.
Hop counter and per-turn caps land here, before anything can loop.

**3 · Handoffs (≈0.5 day).** Allow bots to mention. Mechanically this is phase 2
with the author check relaxed, plus the loop guards actually earning their keep.

**4 · Coordination polish (≈1 day).** A room objective that persists, "who is
working on what" state, and an idle notice when every bot is waiting on the
human.

Total: **3–4 days** for something genuinely comparable to the products that
advertise this.

## Risks

- Touches the thread and run model, which is the core of the system. Build on a
  branch; do not deploy mid-week without a rollback path.
- The migration is additive and reversible, but it is the first schema change
  Manor has made beyond upstream's.
- Upstream may build the same feature. Worth a look at their repo before
  starting, and worth offering ours upstream afterwards.

## Not in scope

Bots initiating rooms on their own, cross-workspace rooms, and voice rooms. All
plausible later; none needed to make the core idea real.
