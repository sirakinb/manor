# CRM Connect — developer guide

Use Manor's CRM from an external agent without a Manor account. One credential
gets you a remote MCP server, a REST API, and signed webhooks — all reading and
writing the same data the Manor UI shows. The product pitch lives in
[crm-connect.md](./crm-connect.md); this is the how-to.

`https://your-manor-host` below stands for wherever the Manor API is deployed
(self-hosted or a hosted workspace).

## Get a credential

A workspace owner mints keys in the Manor app: **Integrations → CRM API
access → Machine credentials**. Pick a name and scopes, create, and copy the
token — it is shown once and stored hashed.

Tokens look like `manor_…` and are sent as a bearer header on every call:

```
Authorization: Bearer manor_your_token_here
```

Scopes:

| Scope             | Grants                                                    |
| ----------------- | --------------------------------------------------------- |
| `crm:read`        | Read contacts, pipelines, deals, modules, records          |
| `crm:write`       | Create/update contacts, deals, modules, records            |
| `webhooks:manage` | Register, list, and delete webhook endpoints               |

Every credential is bound to one workspace; all results are scoped to it.
Revoke a credential from the same panel to cut off that agent instantly.

## MCP server

Endpoint: `POST https://your-manor-host/mcp/crm` (Streamable HTTP transport).

Any MCP client works. Claude Code:

```sh
claude mcp add manor-crm --transport http https://your-manor-host/mcp/crm \
  --header "Authorization: Bearer manor_your_token_here"
```

Generic `mcpServers` config:

```json
{
  "mcpServers": {
    "manor-crm": {
      "type": "http",
      "url": "https://your-manor-host/mcp/crm",
      "headers": { "Authorization": "Bearer manor_your_token_here" }
    }
  }
}
```

### Tool catalog

Read tools need `crm:read`; the rest need `crm:write`.

| Tool                | What it does                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `crm_overview`      | Pipelines with stages, per-stage deal counts/values, totals, deals, recent contacts, tags. Call first.    |
| `crm_find_contacts` | Search contacts by name, company, email, or phone; returns contacts with their deals.                     |
| `crm_upsert_contact`| Create a contact, or update one by `contact_id`. `tags` replaces the tag list.                            |
| `crm_create_deal`   | Open a deal; pipeline/stage matched by name, contact linked by id or name lookup.                         |
| `crm_update_deal`   | Change title, value, linked contact, or mark won/lost via `status`.                                       |
| `crm_move_deal`     | Move a deal to another stage by name (case-insensitive).                                                  |
| `crm_list_modules`  | List custom modules (user-defined sheets) with fields, types, select options, record counts.              |
| `crm_create_module` | Create a module with typed fields: text, number, date, checkbox, select, email, phone, url.               |
| `crm_list_records`  | Page through a module's records; module by name or id, values keyed by field label, cursor to continue.   |
| `crm_upsert_record` | Create a record, or update one by `record_id`. `values` maps field labels (or ids) to values; null clears.|
| `crm_delete_record` | Delete a record.                                                                                          |

Values are validated per field type on the server: numbers accept `"1,450"`,
checkboxes accept `true`/`"true"`, select values match options
case-insensitively, and a bad value comes back as a tool error naming the
field — the same rules the Manor UI enforces, because it is the same code path.

## REST API

Base: `https://your-manor-host/v1`. The machine-readable spec is at
`GET /v1/openapi.json` (no auth required).

| Method   | Path                          | Scope             | Notes                                            |
| -------- | ----------------------------- | ----------------- | ------------------------------------------------ |
| GET      | `/crm/contacts`               | `crm:read`        | `updated_after` filter, cursor pagination        |
| POST     | `/crm/contacts/upsert`        | `crm:write`       | Idempotency-Key supported                        |
| GET      | `/crm/contacts/:id`           | `crm:read`        |                                                  |
| GET      | `/crm/pipelines`              | `crm:read`        |                                                  |
| GET      | `/crm/deals`                  | `crm:read`        |                                                  |
| POST     | `/crm/deals`                  | `crm:write`       | Idempotency-Key supported                        |
| PATCH    | `/crm/deals/:id`              | `crm:write`       |                                                  |
| POST     | `/crm/deals/:id/move`         | `crm:write`       |                                                  |
| GET      | `/crm/modules`                | `crm:read`        |                                                  |
| POST     | `/crm/modules`                | `crm:write`       | Name + typed fields; Idempotency-Key supported   |
| GET      | `/crm/modules/:id/records`    | `crm:read`        | Cursor pagination (`cursor`, `limit` ≤ 200)      |
| POST     | `/crm/modules/:id/records`    | `crm:write`       | Idempotency-Key supported                        |
| PATCH    | `/crm/records/:id`            | `crm:write`       | Partial update; null clears a field              |
| DELETE   | `/crm/records/:id`            | `crm:write`       |                                                  |
| GET/POST | `/webhooks`, DELETE `/webhooks/:id` | `webhooks:manage` | See below                                  |

Conventions:

- **Idempotency**: send an `Idempotency-Key` header on writes; replaying the
  same key returns the original result, and reusing a key with a different
  body is a 409.
- **Pagination**: list endpoints return `{ data, next_cursor }`; pass
  `cursor=` to continue. Cursors are opaque.
- **Errors**: JSON `{ "error": { "message": … } }` with 401 (bad token),
  403 (missing scope), 404 (not found / other workspace), 400 (bad input).

## Webhooks

Register an endpoint (scope `webhooks:manage`):

```
POST /v1/webhooks
{ "url": "https://agent.example.com/hooks/manor", "events": ["contact.created", "record.updated"] }
```

The response includes a signing secret, shown once. Events:
`contact.created`, `contact.updated`, `deal.created`, `deal.updated`,
`deal.stage_changed`, `record.created`, `record.updated`.

Deliveries are POSTs with headers `x-manor-event`, `x-manor-delivery`,
`x-manor-timestamp`, and `x-manor-signature`. Verify by computing

```
"v1=" + hex(hmac_sha256(secret, timestamp + "." + rawBody))
```

and comparing against `x-manor-signature`; reject stale timestamps to prevent
replay. Failed deliveries are retried with backoff.

## A first workflow

An assistant agent that transacts for its user can keep its book of record in
Manor with three calls: `crm_upsert_contact` for each counterparty,
`crm_create_deal` for each commitment, and a custom module (say "Agent Logs",
via `crm_create_module` once, then `crm_upsert_record`) for its activity trail.
The human opens Manor and sees the same data as list, kanban, and sheet views —
no sync, because there is nothing to sync.
