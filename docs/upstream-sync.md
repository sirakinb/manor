# Upstream sync protocol

Manor is a fork of `elie222/rakazo`. Upstream keeps moving; Manor keeps its own
features and skin. This is the repeatable playbook for pulling upstream in
without clobbering Manor's work. The visual companion lives in
`docs/dev-site/` (open `index.html` for the branch/merge flowchart,
`changelog.html` for the running changelog — update the changelog after every
notable change or sync).

## Staged sync in progress (started 2026-11-20)

Manor fell 26 upstream releases behind, so this sync lands one upstream release tag
at a time. Each stage is a branch `sync/upstream-<tag>` and a draft PR stacked on the
previous stage. CI is the verification gate; the local stack is not run. Production is
deployed once, after every stage has landed and a rehearsal against a copy of
production data has passed.

Stages done: `v0.1.6`, `v0.2.0`, `v0.3.0`, `v0.3.3`, `v0.3.5`, `v0.3.6`, `v0.4.0`,
`v0.5.0`, `v0.6.0`. In progress: `v0.7.0`.

### How a stage is resolved

1. Branch from the previous stage, `git merge --no-commit <tag>` with
   `merge.conflictStyle=zdiff3`, `rerere.enabled`, and `merge.renameLimit=8000`.
2. Mechanical files: identity docs (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`,
   `CHANGELOG.md`, `SETUP_PROMPT.md`) and Manor icons take ours; `pnpm-lock.yaml`
   and the message catalogs take theirs. After code is resolved, carry Manor's
   existing translations back into the catalogs, then run `intl:extract`, then
   `pnpm install`.
3. Everything else is a hand union: Manor keeps every feature it has and gains
   everything upstream added. Where both sides changed the same code for the same
   purpose, upstream's structure is canonical and Manor's deliberate delta is
   re-applied on top.
4. Verify: `pnpm --filter @rakazo/web intl:extract` leaves the catalogs unchanged (CI's
   lint job fails otherwise, so re-run it after any late string change),
   `pnpm exec turbo run check --continue`, `pnpm lint`, `prisma validate`,
   `pnpm exec turbo run test --continue`, then CI for Postgres journeys and Playwright.
5. Rehearse the stage's migrations with `prisma migrate deploy` against the copy of
   production data, and compare tenant row counts before and after.
6. Compare file modes with upstream (`git ls-tree -r`): a merge can keep a file's
   content and drop an executable bit upstream added.
7. Compare every Manor-only file between the previous stage and this one. Anything
   beyond an import path or logging change in CRM or Workspace code gets a review.

### Decisions that hold for every stage

- Intermediate behaviour never reaches users, so where Manor has no deliberate,
  documented delta, upstream's behaviour is taken as is. This keeps later stages
  mergeable. Manor-owned features stay exactly as they are.
- Manor-owned features: the CRM (organization-scoped), the Workspace domain with its
  `workspace.automation.run` and `workspace.report.generate` jobs and ingestion
  runner, brands and portal restrictions, channel messaging, public forms, the MCP
  OAuth server and `/mcp/crm`, `/mcp/workspace`, the release controller, the activity
  timeline, the reply check, "This Mac" local computers and `LocalAwareSandbox`.
- `components/beautiful-ui` is `components/ai`, as upstream renamed it. Manor's pill
  button and the `--bui-*` variables live in `components/ai/manor-primitives.*`.
- Brands set the accent family as plain colour values (`lib/brand-theme.ts`).
  Surfaces are not tinted for any brand.
- The web app is pinned to dark (`PINNED_APPEARANCE` in `lib/ui-appearance.ts`).
  Manor's `--rk-*` skin has no light version.
- Upstream's approval gate for webhook-triggered runs and its email verification
  gate are adopted. `20261120120000_mark_existing_users_verified` marks existing
  accounts verified; `provision-team.ts` creates verified users.
- New code in the API, worker, adapters, db and supervisor logs through
  `getLogger()`; `console.*` is a lint error there.
- Product strings say Manor. Internal identifiers (`@rakazo/*`, `RAKAZO_*`) stay.
- Manor's mobile screens stay in plain English where the mobile catalog test would
  otherwise require a translation.
- E2E specs must not import app modules that use the translation macro; Playwright
  cannot load them.
- Upstream tests whose fixtures lack models Manor's code reads (`spaceMember`,
  `workspace`, `organization`, `localComputerSession`, `maintenanceJob`,
  `workspaceAutomation`) get those added to the fixture; assertions are not weakened.
- Manor's header keeps its Files, Run logs and Agent computer buttons under the
  full-screen computer, so E2E locators for those names are scoped to a container.
- Manor's sprite avatars show for the robot style on sprite colours; upstream specs
  that expect the robot face use a non-sprite colour.
- Avatars: there is no avatar style setting (upstream removed it in `v0.3.5`). Manor's
  sprite is how a bot is drawn when it is on one of Manor's sprite colours and has no
  uploaded image and no chosen shape, on web, desktop and mobile; other cases use
  upstream's avatar. `20261121120000_manor_robot_avatar_default` stays in history.
- Manor-only modules must not statically import sections upstream lazy-loads
  (`KnowledgeSection`), or upstream's code split and its chunk-failure specs break.
- A dropped thread refresh after a send that succeeded is not shown as a send
  failure (Manor's choice; upstream surfaces it).
- Every app icon is Manor's mark: `apps/mobile/app.json` (`icon`, `ios.icon`,
  Android adaptive, notification, splash), `apps/desktop/assets`, and the web app's
  favicons and manifest icons. A merge must not point any of them at upstream's
  `packages/ui-tokens/assets/Rakazo.icon`, and upstream's `export:brand` script is
  never run, since it rewrites them from upstream's artwork.
- Voice calls stay on: production sets `PHONE_CALLS_ENABLED=true`.
- The composer's Send button follows upstream's styling (white), not the brand accent.
- `AI_PRIVACY_URL` points at Pentridge Media's privacy policy, never upstream's.
- Row-level security (upstream, from `v0.3.3`): production keeps connecting as the
  table owner, so the policies filter nothing there, and Manor does not use the
  restricted `rakazo_app` role. Manor's code still declares a context, because
  upstream's test harness fails any query without one: request routes run in the
  caller's space; the CRM and Workspace REST/MCP API runs as the integration
  token's owner; public forms, channel inbound, OAuth, maintenance, Workspace jobs
  and the reconciler's Manor scans run in named `runAsSystem` contexts; Workspace
  credentials are organization-wide and read in a system context after the
  workspace lookup. Operator portal provisioning and the shared space migration
  also run in named system contexts. Inside a context, use an interactive
  transaction: batch `$transaction([...])` is rejected.
- Manor's `*.postgres.test.ts` suites run in CI from `v0.3.3` on (upstream's harness
  finds them by file pattern). They call db and adapter functions in the context
  the real caller uses, and read fixtures through the system client.
- Manor's catch-all around the screen revocation when a user replies during a
  takeover is retired: upstream's `revokeScreenControl` treats a gone sandbox as
  released and surfaces other failures.
- Passkeys are offered only on the primary host (`passkeyRpIdForRequest`); brand
  portals are on another domain and keep password, email-code and Google sign-in.
- Bot computer screens are framed same-host (upstream's `embeddableScreenUrl`). App
  previews stay on the primary host so preview code cannot reach a brand portal
  user's session; the content security policy allows exactly `WEB_ORIGIN` in
  `frame-src` on brand hosts, and `framablePreviewUrl` validates the address.
- The content security policy has a small Manor block: Google Fonts, the `/preview`
  pass-through, and the primary-origin frame source.
- Manor code never creates encrypted rows (`Message`, `Event`, `MemoryRevision`)
  through a nested Prisma write; upstream's content encryption layer rejects that
  even when encryption is off. Create the parent, then the encrypted row directly
  (see `importWorkspaceKnowledge`).
- Names shown from Manor's own RPCs (team members, message authors in shared spaces,
  the organization label) go through upstream's `displayName`, so legacy placeholder
  names never reach the screen.
- Composio is keyed per user and space (`composioEntityId`) everywhere, including
  upstream's fake client in tests.
- The desktop setup's cloud choice is "Manor Cloud"; upstream's fixed cloud option
  is not adopted.
- Auth emails and the passkey relying-party name say Manor.
- The API router is upstream's split (`apps/api/src/routes/*.ts`). Manor's changes to
  upstream procedures live there, as small local edits; Manor-only procedures stay
  together in `router.ts` (`manorRoutes()`). `spaceAuthed` in `routes/context.ts` is
  the team-space tier; a new upstream procedure that touches space-owned resources
  goes on it. After a stage, compare every procedure's tier with the previous stage.
- Deployment owner: upstream removed app-level administrators. Manor keeps
  `deployment_settings.ownerUserId` (lookup in `scope.ts`, first sign-up claim in
  `bootstrap-user.ts`, `me.isDeploymentOwner`) because `maintenance.*` is owner-only.
  What upstream made server-only stays refused in the app.
- Model error text: Manor's short summaries apply to outages, timeouts and rate
  limits; account problems keep the provider's text, which upstream's run-error
  screen turns into advice.
- The installable web app's manifest says Manor with icons declared `any`; brand
  portals have their own manifests under `public/brands/<id>/`. The service worker
  stays away from `/preview`, `/v1`, `/mcp` and `/local-computer`.
- The Android live notification icon (`ic_rakazo_notification`) is Manor's mark.
- Known macOS-only unit failures, which pass on Linux CI: the local folder runtime
  and local sandbox tests (the temp directory is a symlink).
- From `v0.3.6` the run executor, the web shell and the mobile inbox and chat are
  upstream's split modules. Manor's changes live inside them (`run-turn.ts`,
  `run-tool-gate.ts`, `run-tool-selection.ts`, `run-instructions.ts`, `pages/shell/*`,
  `components/thread/*`); Manor-only code sits in its own files beside them
  (`run-tools-manor.ts`, `run-verification.ts`, `run-reasoning.ts`,
  `pages/shell/place-routes.ts`, `components/manor-lockup.tsx`). Such modules arrive
  without conflicts, so a resolver whose file was split owns the new modules too.
- Approvals: the mode (never, auto, ask) is upstream's, stored in upstream's
  account-or-space scope and decided in one place per run (`run-trust.ts`). Manor's
  checker choice, compare and reply check stay on the space row and survive a space's
  override being turned on or off. Manor's `llm` checker goes through upstream's
  reviewer path, so upstream's backup reviewers apply. There is no separate Manor
  switch for auto review.
- Saved logins: upstream's vault (per account or space, `request_secret`,
  `fill_secret`) and Manor's per-bot saved logins (`use_credential`, with a 2FA seed
  and notes the vault lacks) are different things and both stay. No upstream
  migration touches `bot_credentials`. The bot's instructions say which tool goes
  with which.
- Account deletion is refused (`account-deletion-guard.ts`) for a shared-space
  account, for anyone in an organization with other members, and for a sole member
  whose organization has a Workspace, CRM data or public forms. Without the guard,
  deleting one person removed credentials and webhooks the organization relies on.
  Upstream's account export omits Manor's tables; an import only creates new private
  spaces.
- The bot label (`bots.title`) is gone, following upstream. Manor's Workspace team
  panel shows the bot's description instead.
- Upstream's "Rakazo" avatar set draws upstream's mark, so Manor does not offer it
  on web or mobile; a bot that carries it still draws.
- Text a bot writes before a tool step is a note on that step; Manor's activity
  timeline shows it under the step.
- Production starts with plain `prisma migrate deploy`, not upstream's
  `pnpm db:migrate` runner, so a migration marked `-- deferred` applies at once.
  That is fine for one deploy from the old release; after it, going back to the old
  code needs a database restore.
- Manor adds its own check `secrets_workspace_credential_scope_check` (Workspace
  credentials are never space-scoped) beside upstream's looser `secrets_scope_check`.
- Cross-space communication between bots stays inside one organization:
  `crossSpaceCommunicationAllowed` (`packages/db/src/cross-space-communication.ts`) allows
  bots in different Spaces only when both Spaces share an organization and both bots
  opted in. Upstream's default of on for new bots is kept.
- Upstream's row-level security bypass key needs nothing in production: the owner login
  bypasses the policies, and `rls_bypass_keys` stays empty without upstream's migrate
  runner, so the plain bypass is still accepted.
- Manor keeps its Welcome page at `/` on the primary host. Upstream removed its welcome
  screen; a brand portal goes straight to sign-in.
- Bot pages (upstream, from `v0.5.0`) run only in the sandboxed viewer with no
  same-origin access, and shared links live on the primary host. The `pages.*`
  procedures are on the team-space tier, so a shared space's members see the pages its
  bots save. Editing a page that is shared by link asks first.
- Manor's hard-coded colours (Workspace, CRM and other Manor pages) are excluded from
  upstream's hex-colour and `[var(--…)]` lint rules in `biome.json`. A new Manor file
  with hex colours needs an entry there.
- Account and desktop strings are translated upstream, with the product name swapped to
  Manor in every locale: `emailText()` in the auth package does it for emails, and the
  desktop catalogs carry Manor directly.
- CI stays on `ubuntu-latest`; upstream moved to a runner label Manor does not have.
- Saved-home retention (upstream, from `v0.6.0`) deletes a remote computer's stored files
  after a plan ends or the computer goes unused. It runs only with `HOME_RETENTION_ENABLED`
  set as well as billing (`homeRetentionEnabled` in `apps/api/src/home-retention.ts`), and
  never touches This Mac computers (kind `local`): they are excluded from the sweep, and their
  cached copy is kept when a stored home is gone (`home-object-store.ts`).
- Under Never ask, a bot's own instruction change is refused when the run could have been
  steered (not started by the owner, or it took in outside content), as with This Mac and
  shared pages (`prepareOwnBotUpdate` in `run-tool-request.ts`). Ask and Auto are upstream's.
- Routine and webhook runs cannot create schedules: `schedule_create` is hidden from them
  (`schedule-tools.ts`) and refused at dispatch (`run-tools.ts`). Upstream now allows it.
- A push from a bot drawn as Manor's sprite carries no portrait, so the phone shows the app
  icon; other bots keep upstream's portrait. The sprite colours live in
  `packages/contracts/src/manor-sprite-colors.ts` (`drawsManorSprite`).
- Upstream's brighter Executive Violet (`#A97EFE`, the default colour) draws Manor's purple
  sprite like `#8B5CF6`. Stored bot colours are never remapped.
- The account-level bot style (upstream's `botAvatarSet`) is not offered in Manor's apps.
- Manor keeps its organization model (upstream added several organizations per person in
  `v0.7.0`): a session acts only in the organization its portal allows. Upstream's create,
  remove and switch are off behind `ORGANIZATION_CHANGES_AVAILABLE` in
  `apps/api/src/organization-availability.ts` (refused with the `ORGANIZATIONS_UNAVAILABLE`
  reason; `organizations.list` returns only the permitted organization; rename works on it),
  and behind `ORGANIZATION_SWITCHING` in `apps/web/src/lib/organizations.ts` and
  `apps/mobile/lib/organizations.ts`. `requireMembership` limits upstream's lookup to the
  portal's organization and never reads or writes the session's organization pin when one
  is set; a linked bot in another organization is not offered (`otherSpaceOfBot`). Lifting
  this needs `assertPortalAccess`'s primary-organization rule reconciled first.
- A bot cannot change a shared team space account's timezone (`update_preferences` refuses
  that field), since upstream moves every routine on the account's zone with it.

### Open decisions

- Whether to enable upstream's multi-organization switching. With it on, any signed-in
  person can create up to ten organizations they own alone, and a session moves between
  organizations by choosing a Space in another one, or by a per-session pin
  (`session.activeOrganizationId`) set from their latest run. Ownership is a `member` row
  with role `owner`; only a sole-member owner can rename or delete. A non-owner member
  reaches only the Spaces they belong to. Manor would first have to reconcile this with
  the portal rule (one main-portal organization, brand organizations only on their portal).

### Deploy checklist for the staged sync

Things the one production deploy at the end must cover, collected as stages land.

- Set `PHONE_CALLS_ENABLED=true` to keep voice calls. Upstream gates call routes, call
  controls and the bot's `call_user` tool behind it, off by default.
- Keep `PI_DEFAULT_MODEL` set. Upstream's built-in default OpenRouter model differs
  from the one production runs on.
- The mobile app's AI data sharing prompt links to the operator's privacy policy.
  `AI_PRIVACY_URL` in `packages/contracts/src/ai-consent.ts` defaults to Pentridge
  Media's page; `PRIVACY_POLICY_URL` overrides it. That page does not yet describe
  Manor or the model, voice and memory providers Manor sends data to; it needs a
  Manor section before the mobile app goes to people outside the team.
- New accounts get Manor's `robot` avatar style, so they see Manor's sprites;
  `20261121120000_manor_robot_avatar_default` changes only the column default, so
  every existing account keeps its stored style.
- Webhook-triggered runs pause for owner approval on tools outside upstream's
  read-only list until a stage brings upstream's reworked approval settings.
- Approval mode: an account with no saved preference now defaults to Auto. Production
  never set `RAKAZO_AUTO_REVIEW`, so every account asked a person;
  `20261121130000_manor_keep_ask_for_existing_accounts` writes an explicit Ask row
  for every existing account so nothing changes for them. Accounts created later get
  Auto. `RAKAZO_AUTO_REVIEW` is no longer read.
- `20261103120000_drop_dead_bot_and_referral_columns` drops `bots.title` without
  copying it. Eight bots had a label at the time of the rehearsal copy; note them
  from the backup if anyone wants them back as descriptions.
- `20261025200000_account_settings` moves model, voice and approval settings to the
  account (each member's oldest space wins; a space that differs gets an override).
  Compare each tenant's effective model and voice before and after on the copy.
- The vault migrations copy upstream's `bot_secrets` and `agent_secrets`; production
  had none of either, so nothing is copied.
- The app image moves to Node 24, so the release toolchain image must be rebuilt.
- New optional settings reach the API and worker through the environment file:
  `WELCOME_EMAIL_ENABLED` (leave off unless the welcome email has been read),
  `USER_DEVICES_ENABLED`, `RAKAZO_NAV_LINKS`, `VOICE_SUMMARY_MIN_CHARS`,
  `NOVITA_API_KEY`. Upstream sets `RAYON_NUM_THREADS=4` on the web container.
- A running Docker computer is reused on start instead of being set up again.
- Sign-up policy is read only from the environment from `v0.3.5` on, and the API
  writes it into `deployment_settings` on every start. Production's stored allowlist
  has one more entry than its environment's: bring `SIGNUP_ALLOWLIST` up to date
  before deploying, and keep `SIGNUPS_ENABLED` set.
- Push registrations move from files to the encrypted database. With API and worker
  stopped, after the schema migration, run
  `pnpm --filter @rakazo/api shared-storage push-tokens --dry-run`, then without
  `--dry-run`; otherwise phones get no pushes until each user reopens the app.
- `20261023000300_billing_audit` copies every usage record into an append-only audit
  table and blocks truncating it; `20261023000000_thread_read_cursor` rewrites every
  thread; `20261025140000_drop_space_backup_models` drops the old backup model table
  after copying it into model roles. Users on the deployment key keep following
  `PI_DEFAULT_MODEL`; bots' own model overrides are untouched.
- In-app deployment settings and the in-app updater are gone (server-only upstream).
- Content encryption: with `NODE_ENV=production` and `CONTENT_ENCRYPTION` unset,
  upstream encrypts new message content at rest. Keep it off for the sync deploy
  (set it explicitly) until Manor's code that reads message content directly has
  been checked; turning it on is its own change.
- Production is behind Cloudflare and the web proxy: set `CLIENT_IP_HEADER`
  (`cf-connecting-ip`) or `TRUSTED_PROXIES` so auth rate limiting sees real client
  addresses instead of one shared address.
- The web container needs `WEB_ORIGIN` (now passed through in the compose files)
  for app previews on brand portals.
- The API and worker start through `pnpm`, which does not pass the stop signal on;
  upstream now runs `node` directly so in-flight work can finish on stop.
- `20261021000000_team_computer_per_user` rewrites `computers` and `bots`: a shared
  Team Computer becomes its owner's, and other members whose bots used it get a
  stopped computer of their own without the old files. Compare each tenant's
  computers and bots before and after on the rehearsal copy.
- `20261021140000_row_level_security` creates the `rakazo_app` role (needs
  CREATEROLE) and enables policies; the owner login bypasses them.
- `20261020000000_rename_box_computers_to_boat` rewrites stored provider values.
- `20261022000001_message_search_tokens_idx` builds concurrently; recover like the
  other concurrent indexes below.
- Index migrations that can leave work behind if they fail partway:
  - `20261007010000_history_search` and `20261014120001_runs_retry_of_run_id_key_concurrent`
    build concurrently. On failure drop the invalid index
    (`DROP INDEX CONCURRENTLY IF EXISTS "<name>"`), run
    `prisma migrate resolve --rolled-back <migration>`, then deploy again.
  - `20261019010000_call_recovery_index` blocks writes to `messages` while it builds
    and rolls back cleanly; resolve as rolled back and deploy again.
- `20260908090000_message_reaction` drops `messages.thumbsUp` without carrying the
  data over. Count existing thumbs-ups on the backup first.
- `20261120120000_mark_existing_users_verified` must run with the rest, or upstream's
  verification gate can refuse existing accounts.
- `20261108120000_drop_pending_instructions_run` and `20261114120100_rls_bypass_key_required`
  are marked deferred but apply at once under plain `prisma migrate deploy`, so stop the
  API and worker before migrating.
- `20261114120000_rls_bypass_key` creates the schema `rakazo_private`, so the owner login
  needs CREATE on the database.
- The API moves stdio MCP server arguments into encrypted secrets in the background on
  every start, using the existing encryption key.
- Keep `SANDBOX_COMPUTER_MOUNTS` unset in production: a mount reaches every organization's
  bot computers.
- `TICKET_BOARD_ENABLED` decides whether the ticket board shows.
- The desktop release workflow now refuses a tag without a matching changelog section.
- Existing bots have daily check-ins turned off by
  `20261121130200_manor_daily_check_ins_off_for_existing_bots`; upstream's
  `20261116120000_bot_daily_check_ins` would otherwise let every bot with untouched open
  scratchpad items start a run once a day. Bots created afterwards get upstream's default
  (on); a person turns it on per bot in the bot's advanced settings.
- An admin (the deployment owner) can change the whole deployment's computer provider in
  Settings, which re-routes every organization's bot computers.
- Keep `RAKAZO_DESKTOP_STACK_TOKEN` (single-account mode) unset in production.
- The iOS widget extension needs the bundle id `com.pentridgemedia.manor.widgets`
  registered before the first iOS build that includes it.
- Keep `HOME_RETENTION_ENABLED` unset: it would let saved-home retention delete computers'
  stored files once billing is configured.
- Pipedream connections that store only the app name (no account) lose their tools until
  reconnected; upstream dropped the fallback. Count them on the backup first:
  `SELECT count(*) FROM connections WHERE "connectorId" = 'pipedream' AND status = 'connected'
  AND "providerRef" = provider;`
- `20261120120001_runs_bot_id_created_at_idx_concurrent` and
  `20261120120002_drop_runs_bot_id_idx_concurrent` run outside a transaction. On failure drop
  any invalid index (`DROP INDEX CONCURRENTLY IF EXISTS "<name>"`), run
  `prisma migrate resolve --rolled-back <migration>`, then deploy again.
- Desktop updates on Linux and Windows release builds now need signing keys; a build without
  a key refuses updates.
- `SANDBOX_PROVIDER=incus` is not used in production. Never point a copy of production data
  (such as the rehearsal) at a shared Incus project: Incus orphan removal deletes every
  instance labelled with a bot's id, and a copy has the same bot ids.

## Standing rules

1. **Merge, never rebase.** Rebasing rewrites deployed history and re-fights
   every conflict. Merging keeps both stories true. Never force-push main.
2. **Manor features live in Manor-owned files.** New features get their own
   modules (`crm.ts`, `crm-tools.ts`, …) with one-line touchpoints in upstream
   files, so the next sync conflicts on a line, not a feature.
3. **Never sync and deploy in one step.** Main only advances after local
   verification passes. Prod only advances after a checkpoint with Aki.
   Rollback is redeploying the previous commit.
4. **`rerere` stays on** (`git config rerere.enabled true`) so every conflict
   resolution is remembered for the next sync.
5. **This SSD is exFAT.** Before any git operation, vitest run, or bundle:
   `find . -name '._*' -not -path './node_modules/*' -delete`
   (AppleDouble files corrupt git packs and break tooling).

## The loop

```
git fetch upstream
git log --oneline HEAD..upstream/main     # what's new upstream
git cherry HEAD upstream/main             # "-" = we already have it (backport)
git merge-tree --write-tree HEAD upstream/main   # conflict preview, touches nothing
git checkout -b sync/upstream-<YYYY-MM-DD>
git merge upstream/main                   # resolve by the policy table below
# verify locally (checklist below), then land on main
# checkpoint with Aki, then deploy
```

## Conflict policy, by category

| Category | Examples | Policy |
|---|---|---|
| Our contributions returning home | Claude Pro/Max OAuth (`pi-oauth.ts`, upstream #106) | **Ours is canonical.** Diff against upstream's landed copy; absorb only genuine improvements. |
| Backport duplicates | fixes we cherry-picked that upstream later merged | Take **upstream** canonical, re-apply any deliberate Manor deltas. |
| Manor identity | `README.md`, `Shell.tsx`, `Onboarding.tsx`, mobile skin | Keep **Manor's** look and branding, weave in upstream's new logic. |
| High-care files | `router.ts`, `schema.prisma`, `app.ts`, `voice.ts` | Hand-union: keep both sides' routes/models/wiring. |
| Mechanical | `pnpm-lock.yaml` | Take upstream, then `pnpm install` and commit the delta. |
| Generated catalogs | `apps/web/src/locales/*/messages.po` | Conflicts are only `#:` line refs. Take upstream, then **carry Manor's `msgstr` values over from `ORIG_HEAD`** before `intl:extract` — `--theirs` alone silently drops ~270 Manor-only translations per locale. |

Known Manor deltas to preserve through any resolution:

- The CRM: `packages/db/src/crm.ts`, `packages/adapters/src/crm-tools.ts`,
  CRM routes in `router.ts`, CRM pages, the `/app/crm` redirect guard in
  `Shell.tsx`'s `refreshBots`. **The CRM is organization-scoped, not
  space-scoped** (`crm_*` tables key on `organizationId`, migration
  `20260902120000_crm_account_wide`) — a deliberate divergence from
  upstream's space-everything model, added after upstream's private-spaces
  sync moved it to `spaceId` (`20260831120000_manor_tables_to_spaces`). If a
  future sync's schema union re-adds `spaceId` to any `crm_*` table, that's
  wrong; keep `organizationId`.
- The Workspace domain: `Workspace` + `workspace_*` tables in the Prisma
  schema (migration `20260904190458_workspace_core`), `packages/db/src/workspace.ts`,
  `packages/db/src/workspace-pipes.ts`, the `workspace.*` contract and router
  section, and `packages/db/scripts/*pentridge-workspace*`. Organization-scoped
  like the CRM (`workspaces.organizationId` is unique); see `docs/workspace.md`.
- The four Team Computer fixes: owner-change rule in `screen-lease.ts`,
  ref-persist `updateMany` in `packages/adapters/src/computer-lifecycle.ts`, boot-reconcile in
  `router.ts`, try/catch around both `setScreenControl` revocations.
- Channel messaging: the `send_channel_message` filter and dispatch in
  `executor.ts`, `builtin-tools.ts`. Since sync #8 the filter rides on top of
  upstream's `selectBuiltinToolsForRun`, not Manor's own filter chain.
- The activity feed and Manor's skin throughout the web + mobile apps,
  including the mobile sprite avatars (which now wrap upstream's animated
  `OrganicAvatar` rather than replacing it).

Deltas retired in sync #8, so do not resurrect them:

- Manor's Composio `direct_tools` try/catch fallback. Upstream's #383 fixes the
  same preload cap by dropping `sessionPreset` outright; that is canonical now.
- `KeyboardAvoider` in `apps/mobile/app/thread.tsx`. Upstream's
  `react-native-keyboard-controller` handles the header offset natively. The
  component stays only because Manor's CRM screens still use it.

## Verification checklist (before main advances)

```
find . -name '._*' -not -path './node_modules/*' -delete
npx vitest run packages/adapters packages/core packages/contracts packages/db
npx vitest run apps/api apps/web infra/sandboxes/supervisor
pnpm check                    # typecheck, all packages
pnpm lint                     # biome
# `npx prisma` pulls a release-candidate CLI without `validate`; use the pinned one.
(cd packages/db && ./node_modules/.bin/prisma validate)
```

Grep-verify the fix signatures survived:

```
grep -n "ownerId !== current.ownerId" packages/core/src/screen-lease.ts
grep -n "Clients only call boot" apps/api/src/router.ts
```

Known non-blockers: `sandbox-conformance` listFiles failure (macOS writes an
AppleDouble `notes/._result.txt` beside the fixture on the exFAT SSD, so the
listing carries an extra entry; passes on Linux CI), occasional `voice-http`
deadline timing flake (passes on rerun), and
`desktop-sandbox-write-containment.test.ts` "keeps writes on the opened
inode" (macOS-only: the test expects Linux `/proc/self/fd` semantics;
macOS takes the fail-closed pathname branch. Passes on Linux CI).

## Landing and deploying

1. Merge the sync branch into `main` (a fast-forward or merge commit — never
   rebase), push.
2. **Checkpoint with Aki.** Then deploy: rsync to the VPS (`.env*` excluded)
   and `docker compose --env-file .env.vps -f infra/compose/docker-compose.vps.yml up -d --build`.
   New migrations apply on deploy; additive migrations need no DB rollback plan.

   **Read the new migrations first — not all of them are additive.** Redeploying
   the previous commit rolls code back, never data. Run
   `infra/compose/backup-vps.sh` before any deploy that carries a `DELETE`,
   `DROP`, or a non-nullable column, because that backup is the only rollback.

   To list what a deploy will actually apply, diff against the commit prod is
   currently running — the presence of a destructive migration in the tree says
   nothing, since Prisma only runs the ones absent from `_prisma_migrations`:

   ```sh
   git diff --name-only --diff-filter=A <deployed-commit> HEAD -- packages/db/prisma/migrations
   ```

   `0012b_retire_custom_rooms` is the cautionary example, and the reason to run
   that diff rather than grep the tree: it deletes every `threads` row with
   `kind = 'room'`, cascading to their messages, runs, and events. It already
   applied on 2026-08-23 (merge `4835915`), so it is inert now — but it still
   looks alarming in the tree forever.
3. Verify in the prod browser: Team Computer screen + Take control/Release,
   CRM pages, fresh-bot onboarding, and one agent chat that exercises a new
   feature.
4. Add a changelog entry in `docs/dev-site/changelog.html`
   (`class="entry sync"` for the purple dot).
5. Publish the dev-site to https://manor-dev.pages.dev (Cloudflare Pages,
   project `manor-dev`, direct upload — the repo stays private):
   `npx wrangler pages deploy docs/dev-site --project-name manor-dev --branch main`
