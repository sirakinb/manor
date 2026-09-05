# Workspace agents and knowledge

Workspace sections currently show warehouse data without a route to agent chat.
The AI team cards describe ingestion sources, and imported playbooks/context live
outside the native skills and memory systems.

Use the existing organization-scoped workspace repositories, executor approval
pipeline, native agent skills, Markdown memory, and Beautiful UI controls.

## Acceptance criteria

- Workspace tools are exposed only to a current space member whose organization
  has a workspace; every execution rechecks that scope.
- Bots can read all workspace sections and details, log activity, and request an
  automation. Automation runs require organization manager access and follow the
  executor's existing approval policy. Activity tools cannot claim approval.
- Every section offers Ask the team. It opens an accessible bot with an editable,
  unsent draft, supports selecting a bot, and safely handles an empty bot list.
- AI team shows actual accessible bots alongside deterministic Automations.
- Latest imported playbooks become native SKILL.md records and context becomes
  native memory in each member's space. Conversion is transactional, idempotent,
  preserves subsequent edits/deletions, and does not require a hosted provider.
- Retire the legacy Skills tab after conversion. Preserve source records for
  ingestion compatibility and rollback. Existing native skills/memory work on
  web, Electron, and mobile; mobile chat uses the same executor workspace tools.

## Work and verification

1. Add a conversion receipt and shared database conversion/scope helpers.
2. Register validated workspace tools and share automation enqueue logic with API.
3. Add team API and web chat draft handoff using route state; reuse BuiButton.
4. Replace legacy worker cards, remove Skills tab, and connect native knowledge UI.
5. Run offline tool/approval tests, synthetic Postgres migration/isolation tests,
   typecheck/lint, and workspace browser harness with screenshots and unsent-draft
   assertions. Review authorization, repeat execution, and navigation races.

Native skills and durable memory currently scope rows by space and user. Keep
that boundary: every member receives their own native copy, available to their
bots. A conversion receipt prevents silently recreating deleted native knowledge.
Do not migrate credentials; only playbooks and workspace_context rows are read.

## Verification and implementation notes

Implemented the shared tools, native conversion, team API, and unsent composer
handoff. Synthetic database tests cover concurrent first visits, version choice,
member isolation, preserved native edits/deletions, atomic rollback, attributed
activity replay, automation authorization, and concurrent assistant creation.
Executor lifecycle tests cover ordinary runs, approval, and recovery. Browser
coverage selects a specific bot, checks the unsent editable draft, opens native
knowledge, and captures the team and automation layout.

Keep conversion receipts separate from native content: checking for imported
records alone would recreate skills a member intentionally deleted. Keep queue
failures on the existing `error` status so pipeline health detects them. Cards
that share a row need container-width layout rules; viewport breakpoints alone
cramp automation details. On filesystems that create AppleDouble metadata, ignore
`._*` during test discovery; verify filesystem permission assertions on a native
filesystem without changing the conformance expectations.
