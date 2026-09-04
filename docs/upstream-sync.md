# Upstream sync protocol

Manor is a fork of `elie222/rakazo`. Upstream keeps moving; Manor keeps its own
features and skin. This is the repeatable playbook for pulling upstream in
without clobbering Manor's work. The visual companion lives in
`docs/dev-site/` (open `index.html` for the branch/merge flowchart,
`changelog.html` for the running changelog — update the changelog after every
notable change or sync).

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
