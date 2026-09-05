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

## Automations

`workspace_automations` holds one scheduled pipeline per channel pipe, seeded
from the registry in `packages/db/src/workspace-automations.ts` the first
time `workspace.automations.list` runs for a workspace (idempotent; existing
rows keep their schedule and enabled flag):

| Key | Pipeline | Cadence | Credential | Source row |
| --- | --- | --- | --- | --- |
| voice | zoho-agent-logs | every 10 min | zoho-crm | Zoho CRM |
| email | zoho-campaigns | daily 09:00 | zoho-campaigns | Zoho Campaigns |
| instagram | instagram | hourly | instagram | Instagram |
| buildium | buildium | daily 06:00 | buildium | Buildium |
| listings | listings | daily 06:30 | none | Listings (`config`: `remaUrl`, `sheetId`) |
| water | water | Mon 08:00 + 08:00 on the 26th-29th | gmail | Gmail |
| recap | recap | hourly (self-gated) | openrouter | none |

Times are in the automation's timezone (default America/New_York). Crons
reuse the routine cron helpers and are validated strictly on update.

Each wakeup is a `workspace.automation.run` background job, armed like a
routine (`replaceKey` per automation, re-enqueued by the job reconciler from
`nextRunAt`). The handler (`packages/adapters/src/workspace-automation-runner.ts`)
claims the wakeup, opens a `workspace_sync_runs` row linked to the
automation and to its source (created when missing), decrypts only the
credentials the pipeline needs, and asks the ingestion service to run it
through the provider-neutral `IngestionRunner`. The HTTP adapter posts
`{ runId, workspaceId, credentials, options }` to `INGESTION_URL/run/<pipeline>`
with `X-Manor-Timestamp` and `X-Manor-Signature` (HMAC-SHA256 of
`timestamp.body` with `INGESTION_SECRET`), 10-minute timeout. The outcome
lands on the run (`success`/`error`, records, error text ≤ 300 chars), on
the automation (`lastRunAt`, `nextRunAt`), and on the source
(`lastSyncedAt`, `status`). Without `INGESTION_URL` a run is recorded as
`error: ingestion service not configured` and nothing throws.

`options` carries the source row's `config`, `scheduledFor`/`manual`, the
timezone, and the workspace's report settings (name, slug, activity
approval, monthly voice report day/hour, last sent date, recipient) so
self-gating pipelines can decide without a second round trip.

RPC: `workspace.automations.list` (seeds, then lists with `lastRun`,
`nextRunAt`, and a pipe-style `status`), `workspace.automations.run {key}`
(creates a queued run row, enqueues the job, returns `runId`; owners and
admins), `workspace.automations.update {key, enabled?, crons?}` (owners and
admins). Pipes carry `automationKey` and prefer the automation's runs over
the source's runs and the freshness probe.

## Write paths

Two things the owner does daily are operable now, both under `workspace.*`
and both recorded in `workspace_activities` with `verification: approved`
(a human clicked):

- **Water charges → Buildium.** `utilities.charge.save` edits a charge's
  amount or memo before posting (a skipped charge comes back to pending),
  `utilities.charge.skip` parks it, `utilities.charge.post` posts one lease's
  share and `utilities.postAllPending` posts every resolved, pending charge
  oldest due date first (one failure is recorded and the batch continues).
  Posting resolves the bill exactly like `utilities.overview` does, builds
  `{Date, Memo, Lines:[{GLAccountId, Amount, Description}]}`, and calls the
  provider-neutral `PropertyLedger` (`packages/adapter-kit`), whose Buildium
  adapter (`packages/adapters/src/buildium-ledger.ts`) posts to
  `/v1/leases/{leaseId}/charges` with the client-id/secret headers and a 45 s
  timeout. The post row keeps status posted|error, the Buildium charge id,
  the error (300 chars), `postedAt`, and `postedBy`. `dryRun` returns the
  payload without calling. Posting refuses an unresolved bill, an already
  posted charge, a missing GL account, or a missing Buildium credential.
- **Reports.** `reports.update` rewrites the title, summary, and the
  `synthesis.<section>` prose (bullet sections and `recommended_actions`;
  12 items, 200/1200/4000 character caps, severity and priority
  vocabularies), stamping `editedAt`/`editedBy`; refused once approved.
  `reports.approve` stamps `approvedAt`/`approvedBy`. `reports.send` renders
  the email-safe HTML (`packages/core/src/workspace-reports.ts`), sends one
  message per recipient through the deployment's `TransactionalEmailProvider`,
  and on the first success marks the report final, approved (if not yet),
  `sentAt`, and merges `sentTo`; a later failure is returned, not thrown.
  `reports.remove` deletes drafts only (status `draft`, never approved or
  sent; the imported monthly recaps are `final` and stay).

The orchestration lives in `apps/api/src/workspace-actions.ts`; refusals are
`WorkspaceActionError`s the router turns into `BAD_REQUEST` with the message
shown verbatim.

### Settings and credentials

`workspace.settings.get/update` exposes the report schedule fields already on
the workspace (monthly voice and weekly email toggles, day, hour, recipient,
reviewer), `activityApproval`, and two utilities fields that used to be env
vars: `waterGlAccountId` (required before posting) and
`buildiumChargeDescription` (default "Water bill"). Updates are for
organization owners and admins.

`workspace.credentials.list/set/remove` stores one login per provider
(`buildium`, `twilio`, `zoho-crm`, `zoho-campaigns`, `instagram`, `gmail`,
`openrouter`, `smtp`) in `workspace_credentials`, with the field values
sealed by the existing `EncryptedSecretStore` in a `secrets` row of kind
`workspace-credential` (organization-scoped, so no `spaceId`). `list` returns
provider, label, field names, and `updatedAt`, never values; `set` merges
fields and an empty string clears one; each save seals a fresh secret and
drops the old ciphertext. Set and remove are for owners and admins. What each
write path needs:

| Action | Needs |
| --- | --- |
| Post water charges | `buildium` credential with `clientId` and `clientSecret`; `waterGlAccountId` in settings |
| Send reports | Deployment outbound email: `SMTP_URL` and `EMAIL_FROM` (the same provider account emails use); without them `reports.send` returns "Email sending is not configured" |

Everything else in the provider list is stored for the syncs that come with
the ingestion move; nothing reads them yet.

## Deliberately not ported yet

- The syncs themselves (Retell, Zoho Campaigns, Meta Graph, Buildium, the
  Gmail water-bill poller). Data arrives by import until they move.
- Remaining write paths: `log_activity`, `save_skill`, `set_context`,
  activity approval, ad-hoc report generation (OpenRouter synthesis).
- Tour links and the TTS-friendly address rendering used by the voice agent.
- Channels other clients had (intake, cases, SEO, TikTok, YouTube, Meta Ads).
- The MCP/REST surface the old app exposed to agents; Manor's bots will get
  workspace tools the way the CRM got `crm-tools.ts`.
