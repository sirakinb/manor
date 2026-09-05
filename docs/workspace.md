# Workspace: a client's operations warehouse

A Manor account that runs a service business already has bots, a CRM, and
channels. What it did not have is the data those bots act on: the phone
calls the voice agent took, the campaigns that went out, the leases and
listings in the property manager, the water bills that need to become
ledger charges. The Workspace is that warehouse, imported from the
standalone Pentridge Agent Workspace (FastAPI + Supabase) and re-homed in
Manor's own Postgres, behind Manor's own contract, so the pipeline map and
the section panels live where the bots live.

Everything in v1 is a **read**. Write paths (approving activities, posting
water charges to Buildium, generating and sending reports) arrive with the
ingestion move, when the syncs themselves run inside Manor.

## Tenancy

One workspace per organization: `workspaces.organizationId` is unique, and
every child table carries `workspaceId`. The repos resolve the actor's
workspace once (`prisma.workspace.findUnique({ where: { organizationId } })`)
and filter every query by that id. `workspace.status` answers
`{ workspace: null }` for an organization without one, which is what drives
the nav; every other procedure throws `IsolationError("No workspace")`, the
same rule the CRM applies to rows that belong to someone else. A row id
handed in by the client (a call, a report, a campaign) is checked against
the resolved workspace before it is returned.

Like the CRM, this is organization-scoped rather than space-scoped: the
warehouse belongs to the account, and every space under it sees the same
data.

## Tables

All models are prefixed `Workspace` and mapped to `workspace_*` tables. They
mirror the source schema one-to-one so the export/import is a column
rename, not a remodel:

| Channel   | Tables |
| --------- | ------ |
| voice     | `workspace_voice_calls`, `workspace_voice_transcripts`, `workspace_voice_call_analyses`, `workspace_reports` |
| email     | `workspace_email_campaigns`, `workspace_email_campaign_links` |
| social    | `workspace_instagram_daily`, `workspace_instagram_media`, `workspace_instagram_stats` |
| leasing   | `workspace_buildium_applications`, `_leases`, `_properties`, `_listings`, `_units`, `_files`, `workspace_rema_listings`, `workspace_sheet_listings` |
| utilities | `workspace_utility_properties`, `workspace_water_bills`, `workspace_water_bill_charge_posts` |
| shared    | `workspace_sources`, `workspace_sync_runs`, `workspace_activities`, `workspace_skills`, `workspace_context` |

Conventions: source ids are kept as `source*Id` columns with a
`(workspaceId, sourceId)` unique so re-imports upsert; calendar values are
`@db.Date` and come back as `YYYY-MM-DD` strings; timestamps are ISO with
offset; the raw upstream payload rides along in a `raw` JSON column where
the source had one. Two SQL views in the source (`utility_billing_targets`,
`water_bill_charges`) are not views here; the repo computes them in
TypeScript from the base tables (see below).

## Import scripts

`packages/db/scripts/`:

- `export-pentridge-workspace.sh` dumps one workspace from the source
  Postgres to a directory of CSVs, one per table.
- `import-pentridge-workspace.sh --dir <csv-dir> --organization <org-id>
  --name "…" --slug …` stages the CSVs into a scratch schema and runs
  `import-pentridge-workspace.sql`, which casts them into the real columns
  under the given organization. `--replace` deletes an existing workspace
  first (cascades through every `workspace_*` row), which is how a cutover
  re-import refreshes the data.

The scripts are a bridge for the cutover, not a sync. They go away once
the syncs run inside Manor.

## API (oRPC `workspace.*`)

Contract in `packages/contracts/src/workspace.ts`; repos in
`packages/db/src/workspace.ts` (`createWorkspaceRepos(prisma)`), wired as
thin handlers in `apps/api/src/router.ts` next to the CRM.

- `status` — cheap; the workspace summary or null.
- `overview` — the one round trip the pipeline map needs: per-channel KPI
  blocks (only for channels the workspace has; null otherwise), sources,
  pipes, team, and the ten newest activities.
- `system` — the pipes with their run history, for the operator view.
- `voice.stats / calls / call`, `reports.list / get`,
  `email.performance / campaign`, `social.snapshot`,
  `leasing.snapshot / rentals`, `utilities.overview`, `activities.list`,
  `skills.list / get`, `context.list` — one section panel each. Their
  semantics are ported from the source domain layer field for field
  (window vs previous window deltas, rate rounding, funnel ordering, the
  split-evenly water charge rule) so the numbers match what the client has
  been seeing.

Aggregates and day series use parameterized `$queryRaw` tagged templates;
row reads stay in Prisma. All day math is UTC.

### Utilities resolution

`utilities.overview` reproduces the two source views. A **target** is every
active utility property joined to its Buildium property and to the Active
leases on that property: `unmatched` (no property id), `no_active_lease`,
`resolved` (exactly one lease, or several with `splitEvenly`), or
`ambiguous`. A resolved target carries one charge per lease with
`chargeShare` 1 or `round(1/n, 4)`. A **bill** matches a target by
normalized address, takes the target's status (or `unmatched`), and emits
one charge per target lease at `round(billAmount × share, 2)`, with the
charge-post row for that lease folded in when one exists.

## Pipe registry

`packages/db/src/workspace-pipes.ts` is the pipeline map's edge list,
keyed by channel rather than by client: a workspace gets the pipes of the
channels it has. Each pipe names its source, cadence, and a freshness
threshold, plus how we know it is alive:

- **freshness** — the newest timestamp in the landing table. Can say
  flowing or overdue, never failing.
- **sync_runs** — recorded runs, with history and error messages. Used
  automatically when a `workspace_sources` row with the pipe's source name
  has runs.

Each pipe carries `sourceId`, the `workspace_sources` row it reads from
(matched case-insensitively on the full name against the pipe's aliases,
null when none is registered), and `internal`, true only for pipes that
run on data already in the vault (the monthly recap).

Status: `idle` with no signal ever, `failing` when the newest run errored,
`overdue` past the threshold, else `flowing`. The client-facing **team**
rolls the same pipes up into named workers (Call logger, Email tracker,
Social monitor, Leasing sync, Water-bill clerk) in client-safe words:
`setting_up`, `catching_up`, `working` (signal within the hour), `fresh`.
The status math is pure and covered by `workspace-pipes.test.ts`; the
Postgres-gated `workspace.postgres.test.ts` seeds a small workspace and
checks the aggregates end to end.

## Client staff sign-up

A client's staff should land in the client's organization, not in an empty
personal one. `organization.brandId` (unique, nullable) names the white-label
brand from `packages/brands` whose sign-ups join that organization. The
Better Auth `user.create.after` hook reads the request's Origin (falling
back to X-Forwarded-Host, then Host), resolves the brand, and when an
organization claims it, `bootstrapUserSpace` adds the new user as a plain
`member` of the organization and of its default space, seeds the space
memory file and notification row, and creates nothing else. The default
brand, an unknown host, or a brand nobody claims all take the existing
personal bootstrap. The signup policy (enabled flag and allowlist) is
enforced before either path, unchanged.

There is no UI for `brandId`. Claim a brand for the JRH organization once,
in production, with the organization id from the `organization` table:

```sql
update organization set "brandId" = 'jrh' where id = '<jrh-organization-id>';
```

Unset it with `set "brandId" = null`. Members of several organizations see
every space they belong to in the space list; each entry carries
`organizationId` and `organizationName`.

## Deliberately not ported yet

- The syncs themselves (Retell, Zoho Campaigns, Meta Graph, Buildium, the
  Gmail water-bill poller). Data arrives by import until they move.
- Write paths: `log_activity`, `save_skill`, `set_context`, activity
  approval, water-charge posting, report generation and sending.
- Tour links and the TTS-friendly address rendering used by the voice agent.
- Channels other clients had (intake, cases, SEO, TikTok, YouTube, Meta Ads).
- The MCP/REST surface the old app exposed to agents; Manor's bots will get
  workspace tools the way the CRM got `crm-tools.ts`.
