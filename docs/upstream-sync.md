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

Known Manor deltas to preserve through any resolution:

- The CRM: `packages/db/src/crm.ts`, `packages/adapters/src/crm-tools.ts`,
  CRM routes in `router.ts`, CRM pages, the `/app/crm` redirect guard in
  `Shell.tsx`'s `refreshBots`.
- The four Team Computer fixes: owner-change rule in `screen-lease.ts`,
  ref-persist `updateMany` in `packages/adapters/src/computer-lifecycle.ts`, boot-reconcile in
  `router.ts`, try/catch around both `setScreenControl` revocations.
- Channel messaging: the `send_channel_message` filter and dispatch in
  `executor.ts`, `builtin-tools.ts`.
- The activity feed and Manor's skin throughout the web + mobile apps.

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

   The 2026-08 sync carries one: `0012b_retire_custom_rooms` deletes every
   `threads` row with `kind = 'room'` (cascading to their messages, runs, and
   events) and then drops the column. That retires Manor's own multi-bot rooms
   in favour of upstream group chats, and it must run before `0013_group_chats`,
   whose constraint a bot-less room thread would violate. Intended, but
   irreversible on a database that has real rooms in it.
3. Verify in the prod browser: Team Computer screen + Take control/Release,
   CRM pages, fresh-bot onboarding, and one agent chat that exercises a new
   feature.
4. Add a changelog entry in `docs/dev-site/changelog.html`
   (`class="entry sync"` for the purple dot).
5. Publish the dev-site to https://manor-dev.pages.dev (Cloudflare Pages,
   project `manor-dev`, direct upload — the repo stays private):
   `npx wrangler pages deploy docs/dev-site --project-name manor-dev --branch main`
