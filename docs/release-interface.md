# VPS release interface v1

Status: foundation; production activation requires a separate release review.
The Linux executor is in `infra/updater/vps`. It is shared by developers and
the future Maintenance Agent. It contains no agent framework or UI.

## Trust boundary

Run the installed controller from an operator-owned directory, with a private
operator-owned policy and state directory. Never execute the controller from a
development checkout in production. Its Docker access is host administration.
Development containers receive only their own source and synthetic storage:
no production environment files, volumes, host network, Docker socket or keys.

The HTTP listener binds loopback. Reach it through authenticated SSH forwarding
or an authenticated private proxy. A developer bearer token permits submission
and reads; a separate deployment-owner token permits approval and recovery.
Neither token belongs in an agent computer, public repository, browser bundle
or workspace. The admin backend authenticates its caller before proxying.
Deployment approval is an explicit owner action, never an LLM tool action.

## Protocol

`POST /v1/operations` accepts JSON, at most 16 KiB. Every mutation has
`requestId` (a UUID) and `action`. Responses are durable operation records;
long work runs asynchronously. Poll `GET /v1/operations/<requestId>`.
`GET /v1/releases` returns the newest 100 release records.
`GET /v1/history` returns the newest 100 operations.
`GET /v1/deployment` reports the accepted image and any pending recovery phase.
`GET /health` returns liveness only. All other routes require bearer auth.

| Action | Input | Who |
| --- | --- | --- |
| prepare | revision: full 40-character Git commit | developer or owner |
| approve | releaseId, manifestHash | owner |
| deploy | releaseId, manifestHash | developer or owner, after approval |
| rollback | releaseId, manifestHash | owner, approved retained candidate |
| recover | no additional fields | owner |

A release has `releaseId`, `revision`, `imageId`, `manifestHash`,
`policyHash`, `state`, `approved`, and timestamps. Its manifest includes
the exact source commit, immutable local image ID, test evidence hash and
policy hash. A new commit or policy requires a new prepare and owner approval.
A branch name, mutable image tag, dirty checkout or caller-supplied test result
cannot authorize a deployment. Approval of one candidate never approves another.

An operation has `requestId`, `action`, `state` (queued, running,
succeeded, failed or interrupted), `releaseId`, timestamps and a bounded
error code. Repeating an identical request ID returns the original result;
reusing it with different content is rejected. Authentication is checked
before looking up a prior request.

## Durability and rollout

SQLite uses WAL and FULL synchronous commits. An OS file lock serializes
mutations across controller processes. A durable deployment journal records
intent before each external effect. On restart, interrupted operations are
marked interrupted; a pending rollout blocks new deployment until owner
recovery. Recovery reconciles back to the recorded previous image and health
checks it. It does not re-run builds, silently replay approvals or claim that
an uncertain deployment succeeded.

Preparation executes checks and builds inside a bounded, non-root container
without a network or production credentials. A fixed trusted toolchain image
supplies dependencies. Dependency-lock changes fail closed until the operator
provides a matching toolchain. One host lock covers heavy jobs. Disk and memory
admission checks run before starting them.

Deployment uses an operator-installed Compose policy; it never uses Compose,
Dockerfiles, host hooks or shell commands from the candidate repository.
Images are pinned by Docker content ID. The executor closes admission through
a required maintenance adapter, waits for active work to drain, records a
verified backup receipt, switches only the configured application services,
then checks health before reopening admission. Failed health restores the
previous application image. Drain timeout leaves the current release running.
If recovery fails, admission remains closed and the journal requires recovery.

Production adapters must implement durable admission closure and active-work
checks for every API and worker producer, including scheduled jobs. A mere
active-run count is insufficient because new work can race that count.
The included synthetic stack implements the same adapter contract for tests.
Production is disabled by default until its adapter passes conformance and an
owner reviews migration compatibility and the initial rollback image.

## Rollback and database recovery

Retain immutable images for the current and previous accepted release.
No controller operation prunes release images, removes volumes or restores a
database. Application rollback is permitted only by the operator's reviewed
schema-compatibility policy. A migration requiring database recovery must fail
closed and be handled with a separate reviewed restore procedure.

Backup receipts identify verified snapshots without exposing paths or data to
callers. A production adapter must verify database and application-storage
restore readiness. Existing backup scripts rotate old snapshots and therefore
must not be invoked unmodified where retention is outside release authority.

## Maintenance Agent integration

1. Use the same versioned HTTP interface via a backend adapter.
2. Submit the full committed revision and retain the returned request ID.
3. Display test evidence and the manifest hash to the deployment owner.
4. The owner's backend action submits approval with its separate credential.
5. Submit deploy with the same release ID and manifest hash; poll through
   API restarts and report interrupted/failed states as such.
6. Link history and rollback to this controller. Do not shell out to
   `git pull`, Docker, or the legacy `/apply` endpoint as a fallback.

The legacy updater remains opt-in and is not enabled on the VPS. Its useful
boundaries are preserved: argv-only execution, private control access,
application-only recreation, local rollback images and explicit migration
warnings. It cannot serve this protocol unchanged: its lock/history are
in-memory, its fork flow selects a moving branch, it trusts checkout Compose,
and it does not implement approvals, backup receipts or admission closure.
Do not run both executors against the same deployment.
