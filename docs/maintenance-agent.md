# Maintenance Agent

This workstream owns owner-only intake, durable orchestration, review and revision-bound
approval. The VPS workstream owns isolated workspaces and the release executor.

## Integration status

Production defaults to **unavailable**. Issues can be saved, but no code-writing agent,
workspace, preview, public commit, PR or deployment starts until a trusted adapter is
injected into the API and worker composition roots. `TestMaintenanceAdapter` is
explicitly injected by tests; it is never enabled by a production environment flag.
Its UI labels every result as simulated. It does not edit source code or deploy.

The handoff contract is `MaintenanceAdapter` in `packages/adapter-kit/src/maintenance.ts`.
The review schema and RPCs live in `packages/contracts/src/maintenance.ts`. The VPS
workstream should implement this adapter against its service, rather than calling the
existing branch-based updater from the Maintenance Agent.

## Service obligations

- `investigate` starts or polls the same durable operation by `operationId`. Use the
  existing AgentRuntime and workspace/Git primitives inside a dedicated development
  sandbox. The private issue and bounded run diagnostics are untrusted evidence.
  Repository instructions cannot change its tool allowlist or deployment authority.
- Sandbox provisioning must exclude production credentials/data, deployment tokens,
  root and the Docker socket. Attest isolation outside the coding agent. Resource
  limits, workspace expiry and cancellation of abandoned investigation compute belong
  to the workspace service. Cancelling intake prevents release but does not interrupt
  a workspace operation already in flight; that workspace must expire independently.
- Return the exact base and tested commit, diff, required check results, publication
  review and private preview. Only the service may attest isolation, required checks
  and publication safety. Never treat an agent's claim that tests passed as attestation.
  Screenshots, commits and PRs must use synthetic fixtures and exclude private evidence.
- Preview URLs must be HTTPS, authenticated for the current deployment owner, and
  contain no bearer tokens. Preview content must not share the application's trusted
  origin. No preview proxy or public publisher is implemented in this workstream.
- `release` starts or polls a durable, idempotent request for the supplied full commit
  and review key. Revalidate the current deployment owner, the immutable review bundle,
  its tests, base revision and release policy inside the release service. Never resolve
  a mutable branch in place of this revision. The agent cannot call `release` directly.
- The service owns backup, readiness, health checks, rollback and release recovery.
  A dropped connection is an unknown outcome; retry the same operation ID and report
  completion only after confirming that exact revision. Do not start a second release.
- Classify web, native desktop and native mobile changes in the review bundle. Native
  changes require separately published application updates. A server rollout cannot
  replace an installed native application.

## Authorization and persistence

The authoritative `DeploymentSettings.ownerUserId` gates all maintenance RPCs and
background advances. Organization owner/admin roles grant no access. No maintenance
tools are registered with ordinary bots, integrations, or routine execution. Evidence
intake reuses the existing user-owned run diagnostics reader; it does not create a
cross-tenant log reader. Maintenance data remains private in its own database table.

Jobs are recovered by the existing job reconciler after a missed wake or restart.
Version comparisons fence stale results. Approval uses the existing approval-effect
digest primitive over the entire review bundle, including test results. Changed tests,
diffs or revisions require fresh approval. Simulated jobs cannot enter a real adapter.

Web and Electron open Maintenance in a separate window from Account settings, preserving
the current composer. Maintenance drafts are saved in session storage before reload;
storage failure enables a navigation warning. The UI never reloads a window automatically.
Mobile uses the same contracts/controller and gives native update advice after release.

## Remaining wiring

The production workspace/agent adapter, authenticated preview hosting and release service
are deliberately not implemented here. Blocked issues are retained for review; resubmit
them after connecting the service. No production deployment is performed by this PR.
