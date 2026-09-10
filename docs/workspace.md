# Workspace: a client's operations warehouse

A Manor account that runs a service business already has bots, a CRM, and
channels. What it did not have is the data those bots act on: the phone
calls the voice agent took, the campaigns that went out, the leases and
listings in the property manager, the water bills that need to become
ledger charges. The Workspace is that warehouse, imported from the
standalone Pentridge Agent Workspace (FastAPI + Supabase) and re-homed in
Manor's own Postgres, behind Manor's own contract, so the pipeline map and
the section panels live where the bots live.

The warehouse supports section reads, managed automations, water charges,
report review and sending, and bot tools. Consequential actions retain their
authorization and approval boundaries.

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
Better Auth hooks resolve the destination Host, with Origin used only when
Host is absent. Forwarded headers cannot override it. New users join the
claimed organization's default space as members; the signup policy still
applies. A branded portal without a configured organization rejects signup.

`user.portalBrandId` restricts client accounts to their assigned portal.
Session creation, existing-session endpoints, and browser RPC requests all
enforce this boundary. The migration assigns existing users who belong only
to a single branded organization, excluding the deployment owner. Main
portal accounts may access a branded portal only when they belong to its
organization. Its navigation and requested-space checks remain scoped to
that organization, even for administrators. The main portal resolves the
account's earliest membership in an unbranded organization (ordered by
membership creation time, then ID). Its navigation and requested-space
checks stay within that organization too. A saved selection from another
organization is recovered when opening the app; writes are never retried
in a different space. Client teams are accessed through their own portals.

Set `organization.brandId` to a registered brand identifier before inviting
client staff. Each brand can belong to only one organization.

## Team activity and client provisioning

Settings shows the current organization's human team, with last sign-in and
last activity timestamps. Web and Electron send a heartbeat every 30 seconds
while the window is visible, focused, and has received input within five minutes.
Mobile sends the same heartbeat while foregrounded with recent touch activity.
The server expires the green activity indicator after 90 seconds and requires a
live session. Signing out of the last session clears the indicator on the next
refresh. Unrecorded history remains unknown; background agents do not count as
human activity. Every roster read and heartbeat checks current membership.

Client brands include Vibe Code Philly at `vibecodephilly.agentworkspace.cloud`,
using the supplied logo and magenta accents. Set up DNS and tunnel routing to the
same web service as the other client portals before use.

Operators can run `packages/auth/src/provision-team-cli.ts` with the deployment's
database connection. Supply a private JSON object on stdin with `brandId` and
`members` (each has `email` and `name`). Capture stdout to a private file: it
contains newly generated passwords. Existing account passwords and roles are
preserved; new accounts are ordinary members restricted to that client portal.
Never put the input or output in the repository. Account creation and membership
assignment are transactional, and repeating provisioning preserves existing access.

## Demonstration workspace

`createDemoWorkspace` in `packages/db/src/demo-workspace.ts` creates the
Meridian demonstration organization with synthetic operations data and its
own yellow brand. It refuses to overwrite an existing brand claimant and
runs in a transaction. No credentials are copied or created. All automation
and report schedules start disabled; sources represent demonstration
snapshots. Account provisioning and membership assignment are separate from
the fixture, so no passwords or account identities are stored in source.

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

The service itself lives in `apps/ingestion` (Python, FastAPI; see its
README for the request contract, the pipeline list, and the credential
fields each expects). Compose runs it as the `ingestion` service next to the
API and worker (`infra/compose/docker-compose.yml` for dev,
`docker-compose.vps.yml` for the VPS): it needs `DATABASE_URL` and
`INGESTION_SECRET`; the API and worker get `INGESTION_URL=http://ingestion:8080`
and the same `INGESTION_SECRET`. Set `INGESTION_SECRET` in `.env` (dev
falls back to `dev-ingestion-secret`) or `.env.vps` (required). Without
`INGESTION_URL` the automations still schedule, and every run is recorded as
"ingestion service not configured".

Listings need their sources on the "Listings" `workspace_sources` row:
`config = {"remaUrl": "https://<agency>.appfolio.com/listings", "sheetId": "<google sheet id>"}`.
The recap reads three `workspace_context` keys: `recap-revenue-config`
(JSON with `tenant` and `landlord` blocks: avg_rent, mgmt_fee_pct,
placement_fee_pct, value_months, turnover_months, conv_base/low/high,
conv_measured, prospect_fraction), `recap-owner-name`, `recap-agent-name`.

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

### Report generation and previews

Reports contains voice/email date-range generators, monthly audience previews,
weekly email previews, recipients, the reviewer address, and schedules. Previews
create drafts without sending email. The AI team shows platform syncs separately
from the link to these report controls.

`reports.generate` is for organization owners/admins. It validates real calendar
dates, an inclusive range of at most 366 days, and an enabled channel. Monthly
previews require a complete month. It stores a queued report and publishes
`workspace.report.generate`; queue failures leave an explicit error. The worker
loads only the selected narrative provider's credential and calls the optional
ingestion adapter. Generation locks the scoped report row, uses full-window
aggregates with bounded narrative samples, and finishes as a draft. Replayed jobs
cannot replace a finished, edited, approved, or sent report. Pending/error reports
cannot be edited, approved, or sent.

`reports.testEmail` sends a `[Test]` copy to one explicitly entered address using
the normal renderer. It leaves approval, delivery, and recipient history unchanged.
The saved reviewer address pre-fills this form. Automatic reviewer notifications
and daily reminders are not part of this delivery path.

The weekly email automation starts paused, even if imported settings had weekly
reports enabled. Explicitly saving an enabled schedule arms its hourly tick; it
self-gates in Eastern time and covers the previous seven complete days. One
deterministic report ID per workspace/window prevents duplicate weekly drafts.
Schedule toggles update both the report setting and its automation transactionally.

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

The ingestion worker reads the Zoho CRM, Zoho Campaigns, Instagram, Gmail,
Buildium, and recap provider credentials per run. Recaps prefer a saved OpenAI
credential (default model `gpt-5.6-luna`), otherwise use OpenRouter. Only the
selected provider's credential is sent; failures never switch providers.
Twilio and SMTP workspace
credentials are reserved for future adapters; outbound reports still use
the deployment email provider.

## Bots and native knowledge

AI team lists real bots with Chat and Knowledge controls. Chat opens that bot
with an editable, unsent operations question. Section-wide Ask the team controls
and their bot selector have been removed. Native skills and memory remain under
Knowledge; the old Skills tab is retired.

`workspace.team.list/open` uses the actor's current space membership and bot
ownership. The shared executor exposes `workspace_*` tools only when that
membership resolves to an organization with a workspace, and checks membership
again on execution. Read tools cover overview, voice, reports, email, social,
leasing, rentals, utilities, system, activities, and automations.
`workspace_log_activity` records an attributed, pending agent note with replay
deduplication. It cannot approve an action. `workspace_run_automation` reuses the
API enqueue path, requires an organization owner/admin, and passes through the
executor's normal action approval policy.

Latest versions of `workspace_skills` become native SKILL.md records named
`workspace-<name>`; `workspace_context` becomes memory at `workspace/<key>.md`.
Conversion runs when a member opens the team, native knowledge, or a bot/routine
run. Native records retain the existing space-and-user boundary, so each member
gets an independent editable copy. `workspace_knowledge_imports` claims the
conversion transaction once per workspace/member/space. Concurrent visits cannot
duplicate it, and later visits preserve native edits and deletions. Existing
memory paths take precedence; colliding skill names receive a suffix.

Original source rows remain for ingestion compatibility and rollback. Imported
playbooks include guidance to use current workspace tools and treat old commands
and integrations as historical reference; unavailable actions stay unavailable.
Credentials are not read from the credential store by conversion. The behavior
uses shared database and executor code, requires no hosted provider, and also
serves Electron and mobile's existing chat, skills, and memory surfaces.

## Deliberately not ported yet

- Retell prompt refresh and automatic reviewer email reminders.
- Activity record approval controls. Report generation and test email are available.
- Tour links and the TTS-friendly address rendering used by the voice agent.
- Channels other clients had (intake, cases, SEO, TikTok, YouTube, Meta Ads).

## External workspace agents

`/mcp/workspace` serves Streamable HTTP with the existing hashed, revocable
integration tokens. `/mcp/crm` remains compatible. Create tokens under
Integrations → API & agent access; CRM tokens gain no workspace access implicitly.
Clients must support bearer headers; these endpoints do not implement OAuth.

`GET /v1/workspace/tools` advertises the token's granted tools and JSON schemas.
`POST /v1/workspace/tools/<name>` takes the same argument object as MCP, including
for reads. OpenAPI includes every supported workspace tool. The in-app Workspace
documentation and agent setup prompt derive their tool catalog from the same
contracts used by the API and native executor.

- `workspace:read`: operations, reports, context, skills and activities.
- `workspace:context:write`: save shared context with `expectedUpdatedAt` from
  the last read (`null` for a new key).
- `workspace:skills:write`: append skill/artifact versions using `expectedVersion`
  from the last read (`0` for a new name).
- `workspace:activities:write`: append attributed, self-reported outcomes and
  evidence. A stable `idempotencyKey` is required externally. Identical retries
  return the same record; a different payload with that key returns 409.

Context and skill writes serialize per workspace and require current owner/admin
membership. Conflicts return 409 and require reconciliation. Native agents use
the same live shared-knowledge tools; writes follow normal action approval.
Converted personal memory and skills remain separate editable copies. Shared
updates never silently overwrite those copies or resurrect deleted imports.

Activity records display the reported outcome first. Details preserve record
review, source, platform/run identity and safe artifact links. Review is not
execution authorization or a delivery receipt. External writers cannot select
their server attribution or set approval fields. Report sending, charge posting,
automation execution, SMS, Retell updates and unsupported legacy channels are
not exposed through this external endpoint.

## Connection status and utility billing

Settings shows the active deployment email provider (for example Resend) as
connected when delivery is configured. It does not read the unused workspace
SMTP slot or expose the SMTP URL. This is configuration status, not a live
delivery check. Credential field names appear only while editing; saved provider
credentials show one Configured status. Twilio's workspace slot does not describe
the health of an original external voice workflow.

Utility summaries distinguish bills, properties and per-lease charges. A split
bill can produce multiple charges. Only `pass_through` properties create pending
charges; blocked, tenant-direct and owner-sent billing modes retain their labels
and cannot be posted through single or bulk charge actions.

Utilities opens on the property roster. Each row shows the imported billing notes,
current lease allocation, and the next step. Manual handling stays distinct from
bills whose service address is unmatched. Property bill links use the resolved
utility-property ID, including when the bill address uses different formatting.
The Bills view keeps charge review, skip/restore, and posting behind the existing
confirmation flow. Bulk posting is only offered in the unfiltered, all-bills view.
