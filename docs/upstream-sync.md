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

Stages done: `v0.1.6`, `v0.2.0`. In progress: `v0.3.0`.

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
4. Verify: `pnpm exec turbo run check --continue`, `pnpm lint`, `prisma validate`,
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
- Manor's default avatar style is `robot`, so its sprites show for new accounts too;
  upstream's `organic` stays available as an explicit choice. Every fallback reads
  `DEFAULT_AVATAR_STYLE` in `packages/core/src/avatar-style.ts`, and the column default
  is set by Manor's own migration `20261121120000_manor_robot_avatar_default` (the
  schema default matches). Upstream's `20261015120000_organic_avatar_default` stays
  untouched. If a later upstream release removes the robot style, Manor keeps a sprite
  style as its default rather than losing its sprites.
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
- Known macOS-only unit failures, which pass on Linux CI: the local folder runtime
  and local sandbox tests (the temp directory is a symlink).

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
- A running Docker computer is reused on start instead of being set up again.
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
