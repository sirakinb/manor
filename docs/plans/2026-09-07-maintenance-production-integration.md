# Maintenance and VPS production integration

## Outcome

The deployment owner can submit a private issue, let the existing agent runtime
edit an isolated VPS workspace, inspect a tested revision, and explicitly approve
that immutable release. Existing application and native update boundaries remain
visible. The original architecture document is preserved alongside a V2 document.

## Implementation sequence

1. Integrate the reviewed maintenance and VPS foundations in an isolated branch.
   Preserve concurrent work and verify current CI, reviews and production capacity.
2. Add a private, bounded workspace broker around the existing workspace executor.
   Fix repository, image, workspace identity and resource policy outside candidates.
   Expose container execution only; never host execution, production credentials,
   release approval or public publishing to the coding agent.
3. Connect the existing AgentRuntime through a production MaintenanceAdapter.
   Persist progress and operation identities; fence concurrent advances and report
   interrupted investigations without blindly replaying arbitrary commands.
4. Bind the review and owner approval to the prepared release manifest. Use the
   existing release controller for prepare, approval, deployment and recovery.
   Reject stale policy, unsupported native/schema/dependency changes and unknown
   outcomes. Do not introduce a second deployment executor.
5. Implement durable production admission and verified backups, including worker
   producers. Exercise closure, drain, failure and recovery on synthetic state
   before activation. Preserve current and previous images and all production data.
6. Complete shared UI state, private change preview, reload advice and persisted
   drafts. Keep web/Electron and applicable mobile behavior consistent.
7. Run deterministic authorization, lifecycle, transport and UI checks; run Linux
   isolation/release conformance; inspect the CI screenshot and resolve automated
   review feedback. Merge only reviewed passing revisions.
8. Back up and deploy the approved revision. Verify health, owner access, denied
   non-owner access, a real isolated maintenance investigation, and restart/release
   recovery. Record any unsupported workflow accurately instead of simulating it.
9. Serve a separate architecture V2 HTML document on localhost, with diagrams for
   the application, workspace, approval, rollout and recovery flows. Keep V1 intact.

## Acceptance boundaries

- Current database deployment ownership authorizes UI, API and background work;
  organization roles do not. Model-generated instructions cannot grant authority.
- Evidence and source remain private; the agent cannot publish commits or PRs.
- Candidate code executes as non-root with bounded resources, synthetic data and
  no host socket, production environment, model keys or release credentials.
- Every external mutation has a durable identity. Approval binds all tested
  evidence and the release manifest. Recovery never substitutes a moving branch.
- Backup and admission failure prevent rollout. Database restoration is never
  silently substituted for application rollback.
- Browser work survives reload; native changes require a separately reviewed
  application distribution rather than claiming a server restart updates binaries.

## Validation and release evidence

Record completed checks, integration limitations and the actual deployed revision
in the implementation documentation and PR. Use synthetic screenshots only.
