# Manor CRM Connect

**Connect, don't sign up.** Manor's CRM as an open surface any agent can plug into.

## The problem

Assistant agents are starting to act on people's behalf — signing up for services,
transacting, managing relationships. Every one of those agents needs somewhere to
keep structured records of people, conversations, and deals. Today that means either
building a datastore from scratch or forcing the agent's human to sign up for a CRM,
log in, and click through a UI the agent can't use anyway.

## The idea

Manor already ships with a CRM. We expose it as a **remote MCP server** — the open
protocol that Claude, ChatGPT, and most agent frameworks already speak. An external
agent connects to a URL, presents a key, and gets a scoped set of CRM tools
(read contacts, write leads, log activity, query deals). No Manor account for the
agent, no UI login, no SDK to install.

## How access works

- A Manor workspace owner mints a **connect key** from their workspace settings.
- Each key carries **granular scopes** — e.g. `contacts:read`, `leads:write`,
  `activity:write` — and nothing else. The key *is* the signup.
- Keys are revocable individually, and every call is logged against the key,
  so the workspace owner sees exactly what each connected agent did.
- Later: OAuth flow per the MCP spec, so third-party agents can *request* access
  and the workspace owner approves once — the "Sign in with Manor" of agent data.

This is a proven pattern for us: our client agent-workspace deployments already run
API-key-scoped MCP access in production (key determines workspace, results scoped
to it). CRM Connect generalizes it into a product surface.

## Why it's credible

- **One contract, many surfaces.** The MCP tools are a thin adapter over the exact
  same CRM contracts the Manor web, desktop, and mobile apps use. Nothing forked,
  nothing to drift.
- **Backend owns the rules.** Authorization, validation, and rate limits live
  server-side; the MCP layer only translates. A misbehaving agent can't do anything
  the scopes don't allow.
- **Vendor-neutral by design.** Manor's architecture keeps external services behind
  provider-neutral interfaces — the CRM doesn't care whether the caller is a human
  UI, Claude, or a custom assistant agent.

## What this unlocks for an assistant-agent product

Your agent gets a persistent, structured memory of the people and deals it manages —
hosted, multi-tenant, permissioned — for the cost of storing one key. Its human can
open the Manor UI at any time and see the same data in a full CRM (list, kanban,
and spreadsheet views), because it *is* the same data.

## Status & next step

This exists today, not as a roadmap item: a remote MCP endpoint (Streamable HTTP)
with scoped, revocable keys minted from the workspace UI, hashed at rest with
one-time reveal, plus idempotent writes and HMAC-signed webhooks for change events.
Developer docs — endpoint, key minting, scopes, tool catalog, REST reference,
and webhook verification — live in [crm-connect-dev.md](./crm-connect-dev.md).
What remains is the OAuth approval flow. A pilot integration with one external agent is the fastest
way to pressure-test the scope model — pick a first workflow (e.g. "agent logs
every commitment it makes for its user as a CRM contact + deal") and wire it up.
