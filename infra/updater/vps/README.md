# VPS development and releases

This Linux foundation runs source editing, Git worktrees, offline tests, builds
and private previews on the VPS. It uses Python's standard library, Git,
Docker Engine and Docker Compose. No hosted build vendor is required.

Read the [release interface](../../../docs/release-interface.md) and its
[request schema](../../../packages/contracts/release-v1.schema.json) before
integrating a client. Developers and the Maintenance Agent use the same
release API; the deployment owner approves a concrete manifest.

## Installation boundary

The supplied controller is **not enabled for production**. Complete the
isolated rehearsal and a concrete release review first. Install reviewed
controller code outside all writable development trees. Keep the policy,
tokens, Git import repository and state owned by the deployment operator.

The controller administers Docker and loop mounts. Its privilege must never
be inherited by an application API, ordinary bot, workspace container or
development agent. Do not grant developers the Docker group, socket, sudo,
root SSH keys, deployment tokens or production environment files.
Expose workspace commands through an operator-controlled broker that fixes
the state directory and workspace identity; do not expose the operator CLI
or let a caller choose policy paths.

Production activation additionally requires a real maintenance adapter.
The synthetic adapter in `fixtures/gate.py` is a test fixture, not a
production implementation. Until admission, all worker producers and backup
verification are integrated, leave the controller disconnected from production.
The old updater must remain disabled for the same target.

## Capacity and isolation

Inspect `df -h /`, `free -h`, `docker system df -v` and running containers
before provisioning. Reserve at least 4 GiB disk and 512 MiB memory outside
each admitted job. Account for the complete build peak, not idle memory.

Defaults deliberately fit one small workspace:

| Resource | Limit |
| --- | --- |
| Workspaces | one |
| Workspace source, Git, synthetic database and storage | 256 MiB ext4 loop filesystem |
| Workspace memory / CPU / process count | 256 MiB / one CPU / 128 |
| Synthetic Postgres memory / CPU | 128 MiB / one-quarter CPU |
| Build writable filesystem | 3 GiB ext4 loop filesystem |
| Build memory / CPU / process count | at most 1 GiB / one CPU / 128 |
| Heavy jobs | one host-wide file lock |
| Source and final artifact archive | 128 MiB each |
| Test command output | 1 MiB |
| Container logs | two files of at most 1 MiB each |

Build scratch is removed after preparation, including on failure and restart.
Retained release images, workspace source and database snapshots are not
removed by that cleanup. No automatic image or backup pruning occurs.
Suspend the workspace before preparing a candidate. The controller refuses
a heavy build while a workspace is running.

Both workspace and rehearsal networks are internal-only. Builds have no
network. Neither uses production networks, named volumes or credentials.
Writable storage has a hard filesystem limit; a malicious test cannot fill
the host through its build mount. The build container has a read-only root,
runs as UID 1000, drops capabilities and has no host socket or keys.

An internal-only Docker network may ignore published ports. Previews use the
private container bridge address through an authenticated SSH tunnel, with
application authentication as well. Never attach a public network merely to
make a preview reachable. See Docker's
[port publishing documentation](https://docs.docker.com/engine/network/port-publishing/).

## Remote source and workspace lifecycle

Keep an operator-owned import repository separate from agent-writable Git.
Fetch an approved repository remote using a narrowly scoped operator
credential. Never copy that credential into a workspace. For an initial
bootstrap, a verified Git bundle of a freshly fetched remote revision works
without installing a Git hosting credential in the sandbox.

All arguments below are illustrative; use your own operator paths and
immutable local toolchain/Postgres image IDs.

```sh
python3 workspace.py --state /var/lib/manor-workspaces --id repair \
  --repository /var/lib/manor-source.git --revision <full-commit> \
  --toolchain sha256:<toolchain-image-id> \
  --postgres-image sha256:<postgres-image-id> create

python3 workspace.py --state /var/lib/manor-workspaces --id repair exec -- \
  git status --short
python3 workspace.py --state /var/lib/manor-workspaces --id repair exec -- \
  python3 -m unittest discover -s infra/updater/vps/tests
python3 workspace.py --state /var/lib/manor-workspaces --id repair \
  --repository /var/lib/manor-source.git submit
python3 workspace.py --state /var/lib/manor-workspaces --id repair suspend
python3 workspace.py --state /var/lib/manor-workspaces --id repair resume
```

Edits and commits happen inside the container's `/workspace/tree` worktree.
Node packages use `/app`, where source is mounted around the toolchain's
installed dependencies. The synthetic database is reachable as `postgres`;
`DATABASE_URL` and `DATA_DIR` refer only to that workspace.
Submissions import a bundle into revision-specific refs after object
validation; the release controller reads the trusted import repository.

A fresh toolchain image must contain `/app/pnpm-lock.yaml` and matching
installed dependencies. The candidate lockfile must match exactly. Dependency
changes require an operator-prepared replacement toolchain and renewed tests;
they cannot silently install packages into a privileged host process.
Each build starts with fresh dependencies from that image.

`destroy` is an explicit operator-only disposal of the selected synthetic
workspace, including its synthetic database. It never targets production.
Inspect a partially provisioned workspace before disposal. Preserve useful
source through a submitted commit first. After a host restart, use `resume`
to remount the bounded filesystem before starting containers.

## Release service

Install the reviewed Python files in a directory such as
`/usr/local/lib/manor-release`; keep the policy and distinct random token
files in an operator-only directory outside the source repository.

```sh
python3 /usr/local/lib/manor-release/release.py \
  --policy /etc/manor-release/policy.json serve
```

Use the included systemd unit as a starting point. The controller binds only
loopback. Put authenticated SSH forwarding or a private authenticated proxy
in front of it. A trusted admin backend keeps the developer credential; only
the deployment-owner action may use the separate owner credential.

The operator policy fixes the source repository, immutable toolchain,
application services, Compose file, environment file, test/build commands,
health probe and maintenance adapter. Both Compose and environment files
must be operator-owned and not writable by developers. They must never come
from the candidate checkout. Start from the synthetic policy generated by
the rehearsal; replace each test-only integration explicitly.

The controller reuses the existing updater's useful execution rules:
argument arrays, explicit Compose project, application-only recreate,
`--no-build --pull never`, cached rollback and an independent control process.
Its durable executor is separate from the legacy in-memory HTTP routes.
Production adoption must choose one executor, not run both.

## Rehearsal and verification

Offline tests need no Docker, database, network service or credentials:

```sh
python3 -m unittest discover -s infra/updater/vps/tests -v
```

The opt-in integration rehearsal requires an operator on a Linux Docker host
with loop-mount support, sufficient headroom, an unused rehearsal namespace
and a clean committed revision. It creates only synthetic resources.

```sh
python3 infra/updater/vps/tests/smoke.py \
  --repository /var/lib/manor-source.git --revision <full-commit> \
  --toolchain sha256:<toolchain-image-id> \
  --postgres-image sha256:<postgres-image-id> \
  --state /var/lib/manor-release-rehearsal
```

It edits and commits remotely, runs offline checks, verifies that unauthenticated
preview requests fail, prepares immutable candidates, refuses rollout while
synthetic work is active, verifies a synthetic database dump, deploys, retries
across a fresh controller, and rolls back the application image.
The state directory retains a verification receipt, release history and
synthetic backups. Database restoration is deliberately not performed.

The CI rehearsal uses a minimal synthetic toolchain. Full application builds
and the repository's existing test suites still run in their existing jobs.
This rehearsal proves the release boundary; it is not a claim that every
native client or production migration was exercised.

## Production integration checklist

1. Review the exact controller revision, policy, capacity budget and retained
   initial application image. Production builds must not replace live services.
2. Implement and verify the maintenance adapter protocol: close durable
   admission, reject every new producer, wait for existing work, verify backup
   restore readiness, and reopen idempotently. Include API calls, timers,
   webhooks, reconciliation and background workers.
3. Use a trusted Compose definition that explicitly names every application
   command, preserves existing storage/network identities and has resource
   limits. Health probes must cover the actual configured services.
4. Review migration compatibility for both rollout and rollback. An image
   rollback does not reverse Prisma migrations or restore a database.
5. Provide the Maintenance Agent backend with the versioned release client
   and scoped workspace broker. Do not give the agent owner approval authority.
6. Configure operator-only service startup and recover an interrupted rehearsal
   before enabling production. A pending journal requires explicit owner recovery.
7. Obtain deployment-owner approval for the exact tested manifest. This task
   opens a draft PR; it does not merge or activate the production controller.

Web, Electron and mobile keep their existing server API. Native installer and
store releases continue through their existing documented release workflows.
