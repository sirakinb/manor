# Maintenance Agent

> Status: dropped from the [product roadmap](../WISHLIST.md#dropped-directions).
> This document records the existing implementation. Code removal is a separate
> task; this status does not disable an existing installation.

This workstream owns owner-only intake, durable orchestration, review and revision-bound
approval. The VPS workstream owns isolated workspaces and the release executor.

## Integration status

The connected adapter uses the existing AgentRuntime, a private Unix-socket workspace
broker and the versioned VPS release service. It is opt-in: without
`MAINTENANCE_CONTROL_SOCKET`, issues are retained but execution remains unavailable.
Partial credentials fail startup; there is no production simulation flag.
`TestMaintenanceAdapter` is injected only by tests and labels its results simulated.

The coding runtime receives one tool, `workspace_exec`, with bounded container argv.
The backend captures the private commit, suspends development, requests independent
checks and displays the exact release manifest. The model has no release tool or
credentials. Owner approval binds the full review and manifest, including image,
evidence and policy hashes. A service restart never blindly repeats an uncertain
coding command; interrupted investigations fail with an explanation.

See [operator setup and recovery](maintenance-operations.md). Installation and activation
are separate from merging the code. An unconfigured deployment remains unavailable.

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

## Supported preview and update boundaries

The connected adapter provides a private source diff preview. Authenticated live
application preview hosting and automatic public PR publication are not connected.
Candidates remain in the private VPS Git import repository. The owner must inspect
the complete diff; credential-pattern checks are not a guarantee of privacy.

Automatic maintenance releases support web and backend changes with an unchanged
schema and toolchain. Infrastructure, dependencies, database and native/shared-native
source require a separate operator release. The review explains browser reloads;
installed desktop/mobile binaries still require their normal distribution workflow.
No client is reloaded automatically. Native maintenance drafts remain in the current
screen; native update advice never triggers an update or discards that screen.
