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
`v0.5.0`, `v0.6.0`, `v0.7.0`, `v0.8.0`, `v0.9.0`, `v0.10.0`, `v0.11.0`, `v0.12.0`, `v0.13.0`, and
upstream's `main` as of 2026-11-22 (commit `31b9ebaaa`, 606 commits after `v0.13.0`). Every
stage's pull request is green. Nothing is deployed yet: the deploy rehearsal and the deploy
itself are what remain.

### How a stage is resolved

1. Branch from the previous stage, `git merge --no-commit <tag>` with
   `merge.conflictStyle=zdiff3`, `rerere.enabled`, and `merge.renameLimit=8000`.
2. Mechanical files: identity docs (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`,
   `CHANGELOG.md`, `SETUP_PROMPT.md`) and Manor icons take ours; `pnpm-lock.yaml`
   and the message catalogs take theirs. After code is resolved, run `pnpm intl:extract`
   from the root (one catalog set for web and mobile,
   `packages/i18n/locales/<locale>/messages.po`, configured in the root `lingui.config.ts`),
   then carry Manor's translations back:
   `python3 scripts/carry-translations.py HEAD packages/i18n/locales/*/messages.po` (for the
   stage that merges `v0.10.0`, where the catalogs were still at `apps/web/src/locales` in the
   previous stage, add `--from 'apps/web/src/locales/{locale}/messages.po'`). Extract first:
   upstream's catalogs lack Manor's own strings, so a carry before extract fills nothing.
   Strings that name the product get the brand-swapped translation (`{brandName}` for web,
   "Manor" for mobile): run the carry again against the merged tag with
   `--swap 'Rakazo={brandName}'` and then `--swap 'Rakazo=Manor'`, which fills a renamed
   string from upstream's translation of the original. Upstream's catalogs lag its code at a
   release tag, and a test requires some new strings in every language, so finish with a
   carry from upstream's current `main` (plain, then with the two swaps): those are upstream's
   own translations arriving a stage early. The catalogs stay committed; no CI check compares them with the code
   and production builds extract a template first, so a missing string shows in English.
   Never commit `packages/i18n/locales/messages.pot`.
3. Everything else is a hand union: Manor keeps every feature it has and gains
   everything upstream added. Where both sides changed the same code for the same
   purpose, upstream's structure is canonical and Manor's deliberate delta is
   re-applied on top.
4. Verify: re-run `pnpm intl:extract` (root) after any late string change, re-run the
   carry, and commit the catalog result; then `pnpm exec turbo run check --continue`,
   `pnpm lint`, `prisma validate`, the unit suites (the catalog tests are
   `apps/web/src/lib/i18n-catalog.test.ts`, `apps/mobile/lib/i18n.test.ts` and
   `packages/i18n/src`), then CI for Postgres journeys and Playwright.
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
- From `v0.10.0` Manor's mobile strings use the Lingui macro like upstream's and fall back to
  English until translated. Mobile says "Manor" in the source; web uses `{brandName}`.
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
  portals are on another domain and keep password and email-code sign-in. Google and Apple
  sign-in buttons are never offered on a portal (see "Decisions made during the sync").
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
- A saved space the account can no longer use recovers through upstream's
  `leaveUnavailableSpace` only (`apps/web/src/lib/rpc.ts`): the saved id is cleared and the
  page reloads into the account's own space. Manor's `recoverInitialSpace` just waits for
  that recovery so the opening screen shows no error. There is no second recovery and no
  in-place shell remount; two paths raced and ended in different states.
- Manor's reply check and approval checker share upstream's verdict parser (`parseModelJson`)
  and its single repair-and-retry (`runCheckerVerdict` in `packages/adapters/src/auto-review.ts`):
  an unreadable verdict gets one more call inside the same deadline, and the cost covers both
  calls. A verdict that still cannot be read is an error, never an approval: an action asks a
  person, and a reply check adds no note.
- Upstream's "Let bots use this computer" (the whole computer, through a paired device or the
  desktop app's bundled local server) and Manor's "Share this Mac" (one picked folder, used by a
  bot set to "This Mac" through `/local-computer` and `LocalSandboxProvider`) are different
  features, and both stay. Upstream's switch for the bundled server needs
  `RAKAZO_DESKTOP_STACK_TOKEN`, which production leaves unset.

- One person per space without a shared account (from `v0.9.0`). Every space is either a team
  space (a shared account plus people) or one person's own space; upstream's spaces shared by
  invite link are a third kind that exists only with `SPACE_SHARING_AVAILABLE` lifted. Why:
  upstream's shared spaces removed the per-person filters on bots, chats, groups, routines, memory,
  artifacts, search and more (about 200 queries) and treat everything in a space as visible to its
  members; keeping one person per non-team space makes that true and private without re-adding
  filters that every later release would have to re-audit. A person joining an organization joins
  its team spaces and gets a space of their own otherwise; an organization keeps one default space
  (`spaces_organizationId_default_key`), so a person's own space is their default through
  `defaultSpaceForMember`, not the space's flag (`joinOrganization` / `ensureOwnSpace`
  in `packages/db/src/bootstrap-user.ts`); the membership trigger
  (`20261211130000_manor_member_joins_team_spaces_only`) adds a new member to team spaces and to the
  default space only while it has nobody in it. `assertSpaceTakesPerson` (`team-space.ts`) guards
  adding a person to an existing space; there is no database trigger guard, because upstream's own
  fixtures and invite flow insert further people into ordinary spaces directly.
  `20261211130100_manor_one_person_per_space` brings existing spaces to one person without
  touching authored content and stops the deploy on a space where two people both own some.
  Derived rows (the seeded memory file, unedited Workspace knowledge and playbooks the Workspace
  import copies, and the import marker) are not content: they go with a removed membership, along
  with that person's notification, auto-review and approval-rule settings and their
  skill, server and plugin availability rows in that space.
- Team spaces (from `v0.9.0`, beside upstream's shared spaces #1935). Manor's team space keeps
  its shared-account model: people act as the space account (`space.accountUserId`), which owns
  the bots, routines, runs, connections and approval rules. The helpers live in
  `packages/db/src/team-space.ts`: `isTeamSpace`, `assertNotTeamSpace` (upstream's invite, join,
  leave, removal and hand-over refuse a team space's shared account), `actsForRunUser` (a person
  in the team space answers and steers the account's runs) and `PERSON_MEMBER` (the shared account
  is never listed, counted as a person, made an owner or marked unread). Per-member unread, snooze
  and message authors use the signed-in person (`initiatedByUserId ?? userId`, `readerUserId`).
  A team space's Team Computer belongs to the shared account (`teamComputerUserId`). A person who
  leaves or is deactivated out of a team space loses only their membership and their own rows;
  nothing is handed over or paused.
- Upstream's sharing of a space by invite link is off: `SPACE_SHARING_AVAILABLE` in
  `apps/api/src/space-sharing-availability.ts` refuses the procedures with
  `SPACE_SHARING_UNAVAILABLE`, and `SPACE_SHARING` in `apps/web/src/lib/space-sharing.ts` and
  `apps/mobile/lib/space-sharing.ts` hides the controls; upstream's code and tests stay and run
  with the flag lifted. Lifting it needs `assertPortalAccess` to admit a person invited from
  another organization (a guest) into that one space, and invite links kept away from team
  spaces, which the data layer already refuses.
- Message authors use upstream's `author` object everywhere; Manor's stored `authorName` stays
  only for the `[name]` prefix in a bot's history.
- Upstream's approval for a bot saving a page shared by link replaces Manor's; Manor keeps only the
  Never-ask refusal of a steerable run's own instruction change.
- `20261129120000_shared_spaces` is the one upstream migration Manor edits: it adds
  `messages."authorUserId"`, which Manor's `20260911001000_shared_space_accounts` already created
  with the same nullable `TEXT` definition, so Manor's copy says `ADD COLUMN IF NOT EXISTS`. A
  later upstream change to that file must keep the guard, or every Manor database fails the deploy.
- A silent run's steps-only row is kept for the activity timeline but never replayed to the model
  (`isStepsOnlyReply` in `packages/adapters/src/reply-context.ts`): a bot turn that is nothing but
  "[tool calls this reply made]" teaches models to answer with a tool-call list. Replies with text
  keep their step lists, as upstream has them.
- `usage.limits` (upstream, from `v0.10.0`) reads a member's own ChatGPT or Claude subscription
  allowance from the provider with that sign-in and needs no billing.
- Docker computers restart themselves after a command stops answering (upstream, from `v0.10.0`):
  a computer that cannot run a trivial command is stopped and started again. The disk is kept;
  running processes and unsaved browser state are lost.
- Deleting an organization is also refused while it holds a Workspace, CRM data or public forms
  (`assertOrganizationDeletable` in `apps/api/src/account-deletion-guard.ts`, the same checks as
  account deletion), so the path stays safe if `ORGANIZATION_CHANGES_AVAILABLE` is lifted. A
  deletion already claimed and stalled is finished.

### Decisions made during the sync

- Multi-organization switching stays off (decided 2026-11-21). With it on, any signed-in
  person can create up to ten organizations they own alone, and a session moves between
  organizations by choosing a Space in another one, or by a per-session pin
  (`session.activeOrganizationId`) set from their latest run. That would let a main-portal
  session move into a client organization the person belongs to, which the portal rule
  exists to prevent, and Manor already reaches each organization through its own portal.
  Turning it on later means reconciling `assertPortalAccess` first, then lifting the flags.
- Saved logins stay in two places (decided 2026-11-21): upstream's vault and Manor's
  per-bot saved logins. Folding Manor's into the vault would need a data migration with
  the encryption key and would lose live 2FA codes and notes, which the vault lacks, for
  no gain to a tenant. Revisit only if upstream's vault gains both.
- A new account's first bot draws Manor's orange sprite (decided 2026-11-21, `v0.11.0`):
  upstream gives it Forge Orange (`#FF781C`), which joined Manor's sprite colours for the
  same reason upstream's default violet did. A bot whose orange came from the colour picker
  carries a chosen shape and keeps upstream's avatar.
- Webhook and email runs follow the owner's approval mode and Always allow rules, as upstream
  has it from `v0.11.0`, instead of always asking. Manor's own refusals still come first: in
  Never ask a This Mac command, a save to a page shared by link and `service_call` are refused,
  a This Mac command is allowed once only, and routine and webhook runs cannot create schedules
  (which also covers upstream's HTTP watch). The checker judges such a run against the owner's
  routine, never the delivery text; with no routine a person decides.
- The release toolchain image has its own stage in `infra/compose/Dockerfile` (`toolchain`),
  because upstream's `build` stage now ends without installed dependencies. The default image
  build does not make it. A release runs as uid 1000, and the stage gives that user one folder,
  the web app's: the web service bundles its Vite config into a temporary file there and cannot
  start otherwise. Everything else in the image stays root's.
- A remote development workspace submits only the commits made in it (decided 2026-11-22). The
  whole history no longer fits the 128 MiB bundle limit now that upstream's history is merged
  in, and the trusted repository already holds the rest.
- The Apple silicon server bundle for the desktop's Docker-free option is published with the
  desktop release in Manor's desktop releases repository; the file keeps upstream's internal
  name.
- Social sign-in buttons are off by default (decided 2026-11-21, `v0.12.0`). Upstream offers
  "Continue with Google" whenever the Google client settings are set, and Manor sets those for
  the Google Forms link, so upstream's rule would change every sign-in page on deploy; on a
  portal the callback also lands on the primary host. The sign-in page lists Google and Apple
  only when `SOCIAL_SIGN_IN_ENABLED` is set and only on the primary host. The provider stays
  registered as before, so the Forms link is unchanged.
- Upstream's organization invitations and member management (`v0.12.0`) stay off behind the
  same flags as create, remove and switch. Their browser spec
  (`e2e/organization-members.spec.ts`) carries a Manor test that the feature is refused while
  off, and upstream's journey is skipped until the flag is lifted. Manor's own team member management stays the way
  people are added. Even with the flags lifted, upstream's code keeps Manor's guards: a person
  who accepts an invitation gets their own space, is never removed from a team space, and a
  shared account is never listed, changed or removed.
- Saved logins still stay in two places after `v0.12.0`, although upstream's vault gained
  per-bot access, imports and authenticator keys. Folding Manor's per-bot saved logins into
  the vault is now possible in principle (the vault has codes; it still has no notes) and is a
  separate change after the sync, with a data migration that needs the encryption key.
- The Workspace file lock uses upstream's `leases` table (key `workspace-files:<computerId>`)
  from `v0.12.0`, because upstream dropped the computer columns Manor used for it. A run does
  not take a computer while a file change holds that lease, and the idle sweep leaves it alone.
- A This Mac bot's routine or webhook run keeps using the team's cloud computer on upstream's
  lazy lease path.
- Upstream's security scan workflows and its search-engine notification for the marketing site
  stay off until their repository variables are set (`SECURITY_SCANS_ENABLED`,
  `WWW_INDEXNOW_ENABLED`). Turning the scans on after the sync is worthwhile; they were gated so
  findings in upstream's code do not block the stacked sync pull requests.
- Upstream's repository checks (`scripts/checks`, from `v0.12.0`; CI runs them as "Script
  tests") apply to Manor's code as well. Upstream's baselines are never edited: what Manor's own
  code has above them lives in `scripts/checks/ratchets/<rule>.manor.json`, rewritten after each
  sync with `node scripts/checks/ratchets.mjs --freeze-manor` (read the diff: a count that grew
  is new code breaking a rule). Manor's entries in the import allowlist and the lease column
  list are marked in those files. The shim check reads upstream's releases from
  `docs/upstream-changelog.md`, a verbatim copy of upstream's `CHANGELOG.md` refreshed at each
  sync (`git show <tag>:CHANGELOG.md > docs/upstream-changelog.md`).
- Upstream's startup bundle budget (`scripts/checks/bundle-size.budgets.json`, from `v0.12.0`)
  is kept at upstream's number. Manor's places (Workspace, CRM, docs) and side panels (files,
  run logs, saved logins) load when opened (`lazyComponent`), which keeps the web app under it.
  A new Manor view is loaded the same way; raise the budget only for code every page needs.
  `scripts/checks/bundle-size.manor.json` can add to a budget for code the fork cannot load
  lazily; it is empty since upstream slimmed the desktop main process, and upstream's budgets
  file stays untouched.
- The mobile app stays on Manor's own version and keeps no Apple sign-in entitlement; upstream's
  `expo-apple-authentication` config plugin is not in Manor's app config.
- Upstream regrouped its source into topic folders in `v0.13.0`. Manor-only files stay where
  they were, except in `packages/core`, whose root may hold only the barrel: Manor's core files
  moved into the matching topic folders (a new `workspace/` among them). After such a release,
  repair the relative imports of Manor-only files mechanically (an unresolved import is pointed
  at the one file of that name in the same package) before type-checking.
- Routines (`v0.13.0`): existing routines keep upstream's default and run alongside their chat.
  Upstream lets a routine read only its owner's messages, which needs two Manor corrections.
  In a team space every person member speaks for the shared account that owns the routine, so
  their messages count as the owner's (one helper in the database package, used by the history
  filter, history search and the checker's view of the owner's words). And existing user
  messages carry no author, because Manor filled that column only in team spaces, so
  `20261231170000_manor_message_authors_for_existing_chats` stamps each with its chat's owner,
  the rule upstream's own team-space conversion uses.
- Meetings (meeting bots, transcripts, calendar scheduling; `v0.13.0`) stay off: no meeting
  provider is set. The code is kept on the team-space tier and says Manor.
- Upstream's Apple Watch companion (`v0.13.0`) is not built: Manor's app configuration does not
  register its plugin, and the plugin's test is skipped while that is so.
- Deep links upstream adds for the mobile app use Manor's scheme (`manor://mcp-oauth`,
  `manor://meeting-calendar-oauth`). The older `rakazo://` callbacks are still a separate change.
- A deployment-provided model counts as connected everywhere a bot's model state is shown
  (`botModelState` in core), so upstream's model picker in chat never tells a deployment-model
  bot to connect a model.
- The marketing site builds without upstream's private pages (upstream's own fallback): the home
  page and docs only, plus Manor's CRM API page.
- Pull request suites run from upstream's shared workflow on GitHub's runners; Manor has no
  Depot account, and the copy under `.depot` is kept only because a check requires the two
  files to match.
- The folder size check takes Manor's allowance from `scripts/checks/folder-size.manor.json`,
  like the per-rule allowances.
- Lifecycle emails follow upstream from the last stage on: the welcome, model connection and
  agent import emails are sent only when the deployment supplies its own copy
  (`EMAIL_COPY_DIR`), and `WELCOME_EMAIL_ENABLED` is gone. The referral email also keeps
  `REFERRAL_EMAIL_ENABLED`. Production supplies no copy, so it sends none of them.
- A page shared with specific people (upstream's page reviews) counts as shared exactly like a
  page shared by link: a bot's save goes through the approval gate and is refused in Never ask
  when the run could have been steered. Page review procedures are on the team-space tier.
- A bot cannot move a bot it manages onto This Mac, and in Never ask a bot's change to its own
  team chat rules is refused when the run could have been steered, like a change to its own
  instructions.
- Upstream's own "Use this Mac" (the desktop app's local server letting bots use the host
  computer) and Manor's "Share this Mac" (a person's Mac reached from a remote Manor server)
  are different mechanisms and both stay. Production sets no desktop stack token and no
  computer host, so upstream's is off there.
- Upstream's "Support Rakazo" prompt in the mobile app (monthly support offers shown whenever
  the app points at a server other than upstream's own) never shows in Manor.
- Upstream's rules for interface copy (no em dash joining clauses, no fixed control heights)
  apply to Manor's own strings and controls, which were changed rather than allowed.
- Manor's migrations are named to sort after upstream's last at the time they are written; a
  Manor migration that has only ever run on a rehearsal copy may be renamed for that.

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
- A message in a group chat that names no bot now starts a run for every bot in the group (up to
  ten) instead of only the first, so busy groups cost more. Each bot may stay silent.
- The iOS share extension needs the bundle id `com.pentridgemedia.manor.expo-sharing-extension`
  and the app group `group.com.pentridgemedia.manor` registered before the next iOS build.
- The desktop app is on Electron 45 (45.2.2 from `v0.8.0`).
- Before deploying `v0.9.0`, resolve every space without a shared account where more than one person
  owns authored content; `20261211130100_manor_one_person_per_space` stops the deploy otherwise.
  Run the query below against the backup first; where it lists a space, the person who is not
  staying deletes their bots there through the product before the deploy. Their derived rows (the seeded `MEMORY.md`, the organization's Workspace knowledge copied into their
  memory, the Workspace playbook skills and the import marker, all unedited) do not block the
  deploy: the migration deletes them with the membership, and the import runs again in the space
  they get at their next sign-in. An edited copy counts as authored. List such spaces, with each
  person's authored and derived rows:

  ```sql
  WITH person AS (
    SELECT m."spaceId", m."userId", u.email,
      EXISTS (SELECT 1 FROM workspace_knowledge_imports k
              WHERE k."spaceId" = m."spaceId" AND k."userId" = m."userId") AS imported
    FROM space_members m
    JOIN "user" u ON u.id = m."userId" AND NOT u."isSpaceAccount"
    JOIN spaces s ON s.id = m."spaceId" AND s."accountUserId" IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM space_invites i
                      WHERE i."spaceId" = m."spaceId" AND i."acceptedAt" IS NOT NULL)
  ), crowded AS (
    SELECT "spaceId" FROM person GROUP BY "spaceId" HAVING count(*) > 1
  ), rows AS (
    SELECT p."spaceId", p.email, t.kind, t.tbl, t.n
    FROM person p JOIN crowded USING ("spaceId")
    CROSS JOIN LATERAL (
      SELECT 'authored' AS kind, a.tbl, a.n FROM (
      SELECT 'bots', count(*) FROM "bots" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'bot_sections', count(*) FROM "bot_sections" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'chat_groups', count(*) FROM "chat_groups" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'threads', count(*) FROM "threads" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'tasks', count(*) FROM "tasks" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'runs', count(*) FROM "runs" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'routines', count(*) FROM "routines" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'scratchpad_items', count(*) FROM "scratchpad_items" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'taught_skills', count(*) FROM "taught_skills" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'agent_imports', count(*) FROM "agent_imports" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'connections', count(*) FROM "connections" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'capability_installs', count(*) FROM "capability_installs" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'mcp_servers', count(*) FROM "mcp_servers" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'secrets', count(*) FROM "secrets" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'bot_credentials', count(*) FROM "bot_credentials" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'bot_secrets', count(*) FROM "bot_secrets" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'vault_credentials', count(*) FROM "vault_credentials" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'artifacts', count(*) FROM "artifacts" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'pages', count(*) FROM "pages" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'computers', count(*) FROM "computers" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'agent_homes', count(*) FROM "agent_homes" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'browser_profiles', count(*) FROM "browser_profiles" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'external_conversations', count(*) FROM "external_conversations" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'messaging_identities', count(*) FROM "messaging_identities" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'messaging_installations', count(*) FROM "messaging_installations" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'cloud_agents', count(*) FROM "cloud_agents" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'local_devices', count(*) FROM "local_devices" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'purchases', count(*) FROM "purchases" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      UNION ALL SELECT 'payments', count(*) FROM "payments" x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      ) a(tbl, n)
      UNION ALL
      SELECT CASE WHEN x.scope = 'user' AND x."botId" IS NULL AND x.revision = 1
                   AND (x.path = 'MEMORY.md' OR (x.path LIKE 'workspace/%' AND p.imported))
                  THEN 'derived' ELSE 'authored' END,
             'memory_documents', count(*)
      FROM memory_documents x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      GROUP BY 1
      UNION ALL
      SELECT CASE WHEN x.source = 'user' AND x."installId" IS NULL AND NOT x."allSpaces"
                   AND x.name LIKE 'workspace-%' AND x."createdAt" = x."updatedAt"
                   AND strpos(x.content, '# Using this imported playbook') > 0 AND p.imported
                  THEN 'derived' ELSE 'authored' END,
             'agent_skills', count(*)
      FROM agent_skills x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
      GROUP BY 1
      UNION ALL
      SELECT 'derived', 'workspace_knowledge_imports', count(*)
      FROM workspace_knowledge_imports x WHERE x."spaceId" = p."spaceId" AND x."userId" = p."userId"
    ) t(kind, tbl, n)
    WHERE t.n > 0
  )
  SELECT "spaceId", email, kind, string_agg(tbl || ' ' || n, ', ' ORDER BY tbl) AS rows
  FROM rows
  GROUP BY "spaceId", email, kind
  ORDER BY "spaceId", email, kind;
  ```

  An `authored` line for more than one person in a space means the migration will stop; its
  message names the space and the counts.
- `v0.9.0` deferred drops apply at once under plain `prisma migrate deploy`:
  `20261126120100_drop_message_history_search_idx`, `20261202120100_drop_thread_unread` (drops
  `threads.unread` and `threads."lastReadSeq"`) and `20261209120100_drop_message_history_search_files_idx`.
  Stop the API and worker first; going back to the old release needs a database restore.
- `20261202120000_thread_reads` locks `threads` (share row exclusive) while it copies each unread
  chat into every member's read state, so chat writes wait for it.
- `v0.9.0` indexes that build outside a transaction (concurrently):
  `20261126120000_external_effects_kind_status_updated_at_idx_concurrent`,
  `20261126120000_message_history_search_with_files`,
  `20261202120100_threads_helper_bot_id_idx_concurrent`,
  `20261202120200_runs_helper_outcome_pending_idx_concurrent`,
  `20261207120100_runs_user_status_idx_concurrent`,
  `20261208120000_billing_audit_amount_idx_concurrent`,
  `20261209120000_message_history_search_with_steps` and `20261210120000_message_tool_work_idx`,
  plus the two concurrent index drops above. On failure drop any invalid index
  (`DROP INDEX CONCURRENTLY IF EXISTS "<name>"`), run
  `prisma migrate resolve --rolled-back <migration>`, then deploy again.
- Leave these unset in production: bot email (`INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_SECRET`,
  `INBOUND_EMAIL_RELAY_ARC_DOMAIN`), paid data services (`PAID_SERVICES_PROVIDER` stays
  `disabled`, no `PAID_SERVICES_API_KEY`), SCIM (`SCIM_BEARER_TOKEN`) and extra sign-in origins
  (`RAKAZO_EXTRA_AUTH_ORIGINS`).
- `COMPUTER_SETTINGS_ENABLED` must be set for Settings to offer the deployment-wide computer
  provider choice; unset, the provider comes from `SANDBOX_PROVIDER` only.
- The release toolchain image can no longer be made by installing dev dependencies into the slim
  release image: build it with `docker build --target toolchain -f infra/compose/Dockerfile .`
  (network access needed for the install). It holds the lockfile and every dependency a build
  needs, and no source.
- From `v0.11.0` a replaced API finishes its requests for up to 20 seconds when it is stopped,
  and clients spread their reconnects; give the API container a stop timeout of at least that.
- From `v0.11.0` webhook and email runs follow the owner's approval mode instead of always
  asking. Before the deploy, read each tenant's mode and Always allow rules on the copy and say
  which routines started by a webhook will now act without a card.
- Microsoft Teams messaging (`TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_APP_TENANT_ID`) stays
  unset.
- `v0.12.0` (41 migrations, rehearsed on the copy: all applied, none failed, no invalid
  indexes, no existing table gained or lost rows; four new empty tables):
  - Stop the API and worker before migrating, as already required. This release's drops
    (`drop_computer_execution_columns`, `drop_computer_control_run`,
    `drop_hand_rolled_delivery_state`, `drop_legacy_run_retry_wake`,
    `drop_signup_settings_columns`) apply at once under plain `prisma migrate deploy`, and
    `queue_unsent_run_replies` queues chat-app replies from the last day again, which could send
    one twice if the old release were still running.
  - `expire_waiting_run_secrets` queues a job for every run waiting on an answer; the copy had
    none. `database_time_zone_utc` sets the database default time zone to UTC; the copy was
    already on UTC, so check `SHOW timezone` on production before the deploy.
  - Nine concurrent index builds and one concurrent index drop run outside a transaction; the
    usual recovery applies if one is interrupted.
  - Keep unset: `SOCIAL_SIGN_IN_ENABLED`, the `APPLE_*` sign-in settings, `DEMO_ACCOUNT_EMAIL`
    and `DEMO_ACCOUNT_PASSWORD` (never in production), `BOT_EMAIL_SMTP_URL`, `DUB_API_KEY`,
    `EXPERIMENTS`, `RAKAZO_COMPUTER_PROXY`, `SANDBOX_COMPUTER_COMPUTE_GPUS`,
    `COMPUTER_DEFAULT_MODE` (default `team`). Keep `GOOGLE_CLIENT_ID` and
    `GOOGLE_CLIENT_SECRET` as they are, for the Forms link. `SMTP_URL` on the worker is no
    longer read; account email is sent by the API.
  - The mobile app asks each person for AI data sharing consent again (the disclosure version
    changed), and every account email has upstream's new layout.
  - Helper bots can now act instead of being read-only, and saving memory after outside content
    asks first in Ask and goes to the checker in Auto. Say so in the release note to tenants.
- `v0.13.0` (17 upstream migrations, rehearsed on the copy: all applied, none failed, no invalid
  indexes, no existing table gained or lost rows; `push_tokens` becomes `push_registrations`
  with its rows carried over, so no phone registers again):
  - Stop the API and worker before migrating, as already required: `drop_push_tokens` and
    `drop_retired_lease_columns` apply at once, and rolling back needs a database restore.
  - Two concurrent index changes on `runs` run outside a transaction; the usual recovery applies.
  - Rehearse `20261231170000_manor_message_authors_for_existing_chats` on a fresh copy and
    compare, per tenant, how many user messages a routine can read before and after.
  - Keep unset: every `MEETING_*` setting, `DEPLOYMENT_VOICE`, `CHAT_HISTORY_RETENTION_DAYS`
    (nothing deletes chat messages while it is unset), `MODEL_CREDIT_OFFERINGS`,
    `RAKAZO_PROXY_CONNECT_BY_HOSTNAME_HOSTS`, `SANDBOX_COMPUTER_BROWSER_PROXY_PAC_URL`,
    `RAKAZO_UPDATER_TOKEN`, `RAKAZO_AUTO_UPDATE_INTERVAL_HOURS` and the `updater` Compose
    profile (production deploys only through the release controller). `WORKSPACE_SAVE_MAX_GB`
    defaults to 5.
  - Approvals changed again upstream: the approval mode alone decides when a bot asks. In Ask,
    saving memory or a skill no longer asks; a webhook-started run now asks with a card that
    expires instead of refusing a purchase, a sign-in or a new site outright. Manor's refusals
    and the allow-once rule for This Mac are unchanged. In Auto, changing another bot's model or
    creating a space now goes to the approval model instead of always asking a person; creating
    a group or a routine for another bot no longer shows a card; in Never ask, a purchase or a
    saved login runs without a card and only the spending limit applies; a scheduled routine
    counts as started by its owner. Say so in the release note to tenants.
  - New for people: a one-time prompt to adopt the device's time zone (never the shared
    account's in a team space), editable outgoing drafts on approval cards, an optional model
    picker in the message box, the mobile inbox opening from a saved copy on the device, and
    every bot being told it runs on Manor.
  - The mobile app needs a new native build (a new native markdown dependency), not an
    over-the-air update.
- Upstream `main` as of 2026-11-22 (19 migrations, rehearsed on the copy: all applied, none
  failed, no invalid indexes, no existing table gained or lost rows; seven new empty tables,
  `speech_allowances` dropped while empty; every computer gets size `standard`):
  - Stop the API and worker before migrating, as already required: three more drops apply at
    once, and `task_prompt_inert_plaintext` scans every task (the copy had none to change).
  - The API and worker now refuse to start on a mistyped setting. Production's
    `SIGNUPS_ENABLED` was checked and is in an accepted form; check
    `RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC`, `RAKAZO_LIVE_MODEL_CATALOG` and
    `RAKAZO_AUTO_REVIEW_MIN_CONFIDENCE` the same way if any is set.
  - Remove `WELCOME_EMAIL_ENABLED` if it is set anywhere. Keep unset: `EMAIL_COPY_DIR` copy
    (the image points at an empty folder), `RAKAZO_MODEL_PROVIDER_ALLOWLIST`,
    `TELEGRAM_GROUPS`, the WhatsApp and Qwen settings, the desktop stack token and any
    computer host setting.
  - Open work nobody has touched for 14 days is parked once a day, only on bots with daily
    check-ins on. Existing bots had check-ins turned off by a Manor migration, so nothing is
    parked for them; nothing is deleted and a parked item can be reopened.
  - New for people: a server-created first bot for a new account, earlier versions of a
    computer's saved files, comments and revision requests on pages shared with reviewers, an
    activity log for organization owners, phone calendars and reminders for bots on mobile
    (new permission prompts), Thai as a language, and the Integrations shortcut moving to
    Cmd/Ctrl+Shift+A on desktop.
  - The mobile app again needs a new native build (calendar and store review modules).
- The whole chain was rehearsed in one run on a fresh copy of the 2026-11-22 backup, with the
  pre-deploy step simulated on the copy: 268 migrations applied in 11 seconds, none failed, no
  invalid indexes, no table removed. The only existing rows that changed are the ones the
  one-person migration is meant to remove (the second person's membership and seeded Workspace
  rows in the one space that had two people) and the approval settings rows the account
  settings migration creates. After the chain:
  - every account and every space is on Ask, and there are no Always allow rules, so none of
    upstream's changes to Auto and Never ask alters what a bot may do without a card;
  - no bot has daily check-ins on, so no open work is parked;
  - every computer is a Docker computer of size `standard`;
  - each chat owner's own earlier messages are readable by their routines (stamped by Manor's
    migration); messages from channels and other bots are not, as intended;
  - production's database time zone is already UTC.
- The final branch's app image was built from `infra/compose/Dockerfile` (about nine minutes,
  3.2 GB) and its API and worker were run against that fresh copy on a network with no
  outbound access, with a throwaway encryption key, `CONTENT_ENCRYPTION=off`,
  `PHONE_CALLS_ENABLED=true` and the Docker computer provider:
  - the API was healthy in about nine seconds and listed no social sign-in providers; a
    signed-out request was refused;
  - with a temporary session for a portal's main user, on that portal's host, the new API
    returned their space and bots, a chat with every block kind Manor adds, computer status,
    approval settings (Ask, Manor's checker), connections, the Workspace (status, overview,
    team, system), the CRM overview and the team list, with no error logged;
  - the worker ran for two minutes with no error and changed nothing: no run, message, thread,
    event, job or computer row was touched, and no lifecycle email was attempted.
- The release controller's candidate build was replayed with its exact limits (one CPU, 1 GiB of
  memory, no network, a read-only root, 30 minutes for each command) in the same isolated engine:
  - the toolchain image builds from the `toolchain` stage in under five minutes; it is 5.6 GB
    and carries the lockfile, which matched the candidate's;
  - the API and worker build inside 1 GiB, but the web build is killed there; it passes with
    2 GiB at a peak of about 1,900 MiB;
  - the built artifact is about 405 MB (about 197 MB without source maps) against the
    controller's 128 MiB, and the build filesystem holds about 2,990 MB against its 3,072 MiB;
  - the policy's test command, the whole unit suite on one worker, completed 96 of about
    2,150 test files in its 30 minutes, so a release needs a short test command and the full
    suite stays with CI;
  - the controller refuses symlinks in source, and upstream added one in a folder for a CI
    vendor Manor does not use, which is now left out of archives.
    The controller's limits became optional policy fields for that reason (a separate change),
    and the policy for this release has to set them, build the API and worker as well as the web
    app, name the new toolchain image and allow the release's revision.
- The updated controller then prepared this branch itself, start to finish, in the same isolated
  engine (2026-11-22): its own `prepare`, under the 512 MiB cap its service runs with, against
  the real toolchain image, with a plain folder standing in for the loop filesystem that engine
  cannot make. With `buildMemoryMb` 3072, `artifactLimitMb` 512, `buildDiskMb` 4096,
  `buildPidsLimit` 256 and `buildTimeoutSeconds` 3600:
  - a preparation takes eight to twelve minutes: about four to seed the build folder from the
    toolchain, two to build, and two to four to commit the image; the acceptance command runs
    in seconds;
  - the controller's own process stays near 206 MiB with a 418 MB artifact, which is spooled to
    disk; the build folder holds about 2,930 MB;
  - the build needs its Node heap capped below the container's limit. The controller sets the
    heap to the limit less 128 MiB, and the web build's bundler uses memory outside that heap:
    at 2,560 MiB one build in seven was killed. With the limit at 3,072 MiB and
    `NODE_OPTIONS=--max-old-space-size=2048` set by the build command, eight builds peaked at
    2,340 MiB or less and none was killed;
  - the test command must give the test runner a writable home (`HOME=/tmp`): the acceptance
    container is read-only and the runner writes a token file. A short command over the shared
    contracts (57 files, 1,236 tests) passes in the build container and in the final image;
  - the image the controller produced was started with production's own service commands on the
    network with no outbound access, against the fresh copy: the API applied no migration and
    was healthy in about ten seconds, the worker ran with no error, the web service served the
    app and reached the API through its proxy, and no run, message, thread, event or job row
    changed.
- The same image was then started with the shape of production's settings: every name the live
  API and worker receive, with each secret and identifying value replaced by a random stand-in
  of the same form, and the two settings this release adds. Both started with no configuration
  error.
- It was also run against the controller's real admission gate, in the order a rollout uses it.
  The controller's own health probe, which requires the admission guard, passed with the gate
  open, passed again for an API started while the gate was closed (the moment after a rollout
  switches images), and passed after reopening; new work was refused while the gate was closed,
  and neither process logged an error.
- The backup a rollout takes is verified by restoring it into a 1 GiB filesystem. The latest
  nightly dump restores there in 20 seconds at a peak of 510 MB, inside the gate's 256 MiB of
  memory.
- **This release has no automatic way back once its migrations have run.** The migrated schema
  drops 14 columns the running release reads (on bots, threads, messages, computers and others),
  so the previous image cannot run against it, and the controller's recovery, which restores the
  previous image and never the database, would not give a working app. The way back is the
  backup the rollout takes after admission closes, restored by an operator, with the previous
  image. Nothing is written between that backup and the migration, so no data would be lost.
  The rollout waits 120 seconds for the services to start, which is fixed in the controller;
  migrating the fresh copy took 11 seconds and the API was healthy about ten seconds later.
- The installed controller matches the repository at the revision it records, apart from one
  operator file the repository does not carry. Installing this change replaces two files,
  `docker_adapter.py` and `workspace.py`.
- A preparation is refused while the interactive development environment is running, as before;
  stop it for the preparation and start it afterwards.
- In production the worker and web containers start only after the API is healthy, and the API
  applies migrations before it starts, so the new code never runs against a half-migrated
  database. The health wait after a rollout is 60 seconds; raise it for this release.
- Node 24.15 or newer is required.
- Upstream's new automation workflows stay off because their repository variables stay unset:
  issue triage (`ISSUE_TRIAGE_ENABLED`), preview builds, deploys and cleanup with their PR
  screenshots (`FLY_PREVIEW_ORG`) and the translation catalog sync (`CATALOG_SYNC_ENABLED`). The
  Google Play release runs only when started by hand or called by another workflow.
- `20261211120001_model_credit_cap_idx_concurrent` builds an index outside a transaction. On
  failure drop the invalid index (`DROP INDEX CONCURRENTLY IF EXISTS "<name>"`), run
  `prisma migrate resolve --rolled-back <migration>`, then deploy again.
- Every pnpm command needs pnpm 12, through corepack.

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

| Category                         | Examples                                                | Policy                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Our contributions returning home | Claude Pro/Max OAuth (`pi-oauth.ts`, upstream #106)     | **Ours is canonical.** Diff against upstream's landed copy; absorb only genuine improvements.                                            |
| Backport duplicates              | fixes we cherry-picked that upstream later merged       | Take **upstream** canonical, re-apply any deliberate Manor deltas.                                                                       |
| Manor identity                   | `README.md`, `Shell.tsx`, `Onboarding.tsx`, mobile skin | Keep **Manor's** look and branding, weave in upstream's new logic.                                                                       |
| High-care files                  | `router.ts`, `schema.prisma`, `app.ts`, `voice.ts`      | Hand-union: keep both sides' routes/models/wiring.                                                                                       |
| Mechanical                       | `pnpm-lock.yaml`                                        | Take upstream, then `pnpm install` and commit the delta.                                                                                 |
| Generated catalogs               | `packages/i18n/locales/*/messages.po`                   | Take upstream, run `pnpm intl:extract`, then carry Manor's `msgstr` values from the previous stage with `scripts/carry-translations.py`. |

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
