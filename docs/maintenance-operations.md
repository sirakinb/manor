# Operating connected maintenance

> Status: the maintenance agent is a [dropped direction](../WISHLIST.md#dropped-directions).
> This guide is retained for existing installations, not recommended as a new
> setup path. Removal of the implementation is a separate task.

Install the reviewed `infra/updater/vps` Python files outside every writable source
checkout. Use `manor-maintenance.service` for the private bridge and the existing
release controller. Keep the legacy updater disabled for this deployment.

## Configuration

The operator-owned policy retains all fields described in the
[release foundation](../infra/updater/vps/README.md). Connected maintenance additionally
requires these fixed values. Never derive paths, images or service names from a job.

| Policy | Purpose |
| --- | --- |
| `controlSocket`, `applicationGroup` | Private socket, accessible only to the trusted API/worker group |
| `workspaceStateDir`, `gateStateDir` | Private durable workspace/admission state outside source |
| `workspaceTokenFile`, `applicationTokenFile`, `operatorTokenFile` | Distinct private credentials, alongside existing owner/developer tokens |
| `gatePort`, `maintenanceUrl`, `maintenanceTokenFile` | Loopback admission adapter; maintenance token is the operator credential |
| `producerServices`, `computerNetwork` | Exact production writers and dedicated computer network |
| `databaseContainer`, `databaseUser`, `databaseName` | Operator-selected production database to back up |
| `postgresImage`, `backupImage` | Immutable trusted PostgreSQL and archive utility image IDs |
| `backupTimeoutSeconds` | Backup request budget, shared by dump, restore and archive stages; defaults to 600 seconds |
| `dataVolume` | Existing application storage volume, never a candidate-selected mount |
| `productionAdmission: true` | Require guarded health and verified backup before switching |
| `compatibilityPolicy: unchanged-schema-and-toolchain-v1` | Permit only compatible application changes |
| `unguardedBootstrapImage` | Optional exact pre-integration rollback image; health may lack admission only for this operator-reviewed image |
| `schemaCompatibleRevisions` | Explicitly reviewed bootstrap revisions, including their rollback compatibility |

Private token files must be operator-owned regular files with mode 0600. Configure
the socket directory as root-owned and mount it read-only into API/worker through
`infra/compose/docker-compose.maintenance.yml`. Put their socket path and four
`MAINTENANCE_*_TOKEN` values in a separate private `application.env`, not the shared
production environment inherited by supervisor or business computers. The coding
runtime uses the existing configured deployment model; its key stays in the backend.

Use an operator-installed combined Compose definition preserving the deployment's
existing project, volumes, networks and commands. The controller must never read a
candidate's Compose file. API and worker images require the full running `GIT_SHA`.
Review additive schema migrations during initial bootstrap; automatic maintenance
cannot change schemas, dependency manifests or native/shared-native source.

## Validation and activation

Run offline tests and both Linux rehearsals before activation. `smoke.py` covers
workspace isolation and immutable builds; `tests/guard_smoke.py` covers the real
admission/backup boundary, synthetic database restore, health rollback and interrupted
rollout recovery. Rehearsal resources are explicitly synthetic and separately named.

Measure live capacity first. The existing build needs 3 GiB scratch plus a 4 GiB
host reserve; backup admission defaults to 4 GiB working headroom plus that reserve.
Restore verification uses its own 1 GiB filesystem and 256 MiB memory. Actual database
and storage growth may require larger budgets. Retain current/previous images and
verified backups. No automated pruning or backup retention is enabled: an operator
must archive and retire obsolete retained artifacts before headroom runs out.

Prepare the exact bootstrap revision using the trusted matching toolchain. Review
the tests, manifest, migration compatibility and existing rollback image. The first
activation must establish a quiet boundary for services that predate admission.
Block external ingress, finish active work and stop the old application writers
before requesting the first rollout. The controller accepts stopped services only
when they use the exact operator-pinned bootstrap image and Docker confirms no live
process remains. They stay stopped through backup and are replaced by Compose.
The optional `unguardedBootstrapImage` permits health verification of the exact old
rollback image, which predates the guard. Reverting to it also reverts maintenance
capability; another bootstrap needs the same operator-established quiet boundary.
Remove that exception after retaining a guarded previous release.
Subsequent compatible releases close admission, drain, verify backups and switch
only configured application services. Never enable the guard before the private
controller and credentials are available.

## Diagnosing failures and recovery

The owner UI retains jobs, progress, the exact review, manifest and release outcome.
Use the private controller's operation history and bounded `last-error.txt` for
executor failures; backup/restore errors remain beside their private snapshot.
These files can contain private evidence. Do not paste them into a public PR or
commit. The application presents bounded explanations, not raw operator output.

Admission has no clock-based lease expiry. A lost completion reply cannot authorize
backup while a writer might still be running. Closed-gate status removes a lease
only after Docker confirms its container is absent or fully stopped. If the same
container restarted with an uncertain old lease, stop/recreate that specific writer
after inspecting active work; do not clear leases while it can still write.

An interrupted rollout leaves a durable journal and requires an explicit owner
`recover` operation through release v1. Recovery restores the recorded previous
application image, verifies health, resumes recorded producers and reopens admission.
If any step fails, retain the journal and investigate. Never substitute a database
restore or a different revision for the recorded recovery action.

An interrupted coding command is not replayed. Its job reports failure, and the
workspace expires independently after one hour. Preserve useful private source
before operator cleanup. Submit a new issue after cleanup to retry.

## Current limits

The Maintenance Agent shows a source diff preview; it does not host an authenticated
live app preview or publish private candidates to a public Git remote. Infrastructure,
database, dependency and native changes use a separately reviewed operator release.
Web updates can use a normal browser reload when the owner is ready; no forced refresh
occurs. Native binaries require a separately distributed app update.
