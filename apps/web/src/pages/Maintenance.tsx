import { MaintenanceCreateSchema, type MaintenanceJob, type Me } from "@rakazo/contracts";
import {
  MaintenanceController,
  maintenanceCanApprove,
  maintenanceUpdateAdvice,
} from "@rakazo/core";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BuiButton, BuiCard, LoadingState } from "../components/beautiful-ui/primitives";
import { rpc } from "../lib/rpc";

export function MaintenancePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    void rpc
      .me()
      .then(setMe)
      .catch(() => setError(true));
  }, []);
  if (error || (me && !me.isDeploymentOwner))
    return (
      <main className="p-8" role="alert">
        Maintenance is restricted to the deployment owner.
      </main>
    );
  if (!me)
    return (
      <main className="p-8">
        <LoadingState label="Loading maintenance" />
      </main>
    );
  return <MaintenancePanel userId={me.userId} />;
}

function MaintenancePanel({ userId }: { userId: string }) {
  const controller = useMemo(() => new MaintenanceController(rpc.maintenance), []);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const draftKey = `manor:maintenance-draft:${userId}`;
  const [initialDraft] = useState(() => {
    try {
      const parsed = MaintenanceCreateSchema.safeParse(
        JSON.parse(sessionStorage.getItem(draftKey) ?? "null"),
      );
      if (parsed.success) return parsed.data;
    } catch {
      /* Unavailable storage or stale draft. */
    }
    const runId = new URLSearchParams(window.location.search).get("runId") ?? "";
    return { issue: "", runId: runId.length <= 200 ? runId : "", requestId: crypto.randomUUID() };
  });
  const [issue, setIssue] = useState(initialDraft.issue);
  const [runId, setRunId] = useState(initialDraft.runId ?? "");
  const [requestId, setRequestId] = useState(initialDraft.requestId);
  const [draftSaved, setDraftSaved] = useState(false);
  const [confirmJob, setConfirmJob] = useState<MaintenanceJob | null>(null);
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ issue, runId: runId || undefined, requestId }),
      );
      setDraftSaved(true);
    } catch {
      setDraftSaved(false);
    }
  }, [draftKey, issue, runId, requestId]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (issue.trim() && !draftSaved) event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [issue, draftSaved]);
  return (
    <main
      className="h-full overflow-y-auto bg-[var(--rk-page)] p-5 text-[#ECECEE]"
      data-testid="maintenance-page"
    >
      <div className="mx-auto max-w-4xl space-y-5 pb-12">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-medium">Maintenance Agent</h1>
          <BuiButton onClick={() => void controller.refresh()}>Refresh</BuiButton>
        </div>
        {state.loading ? <LoadingState label="Loading maintenance" /> : null}
        {state.error ? (
          <p role="alert" className="text-[#F3A59B]">
            {state.error}
          </p>
        ) : null}
        {state.data ? (
          <>
            {state.data.mode !== "connected" ? (
              <p role="status" className="text-sm text-[#A8A8AD]">
                {state.data.mode === "test"
                  ? "Test adapter · simulated investigation and release"
                  : "Workspace and release integration is not connected. You can save an issue for later."}
              </p>
            ) : null}
            <BuiCard className="space-y-3 p-5">
              <label className="block space-y-2">
                <span>Bug or improvement</span>
                <textarea
                  aria-label="Bug or improvement"
                  value={issue}
                  maxLength={8000}
                  rows={4}
                  disabled={state.pending}
                  onChange={(event) => {
                    setIssue(event.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                  className="w-full rounded-xl border border-[#303034] bg-transparent p-3"
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span>Run ID (optional)</span>
                <input
                  aria-label="Run ID (optional)"
                  value={runId}
                  maxLength={200}
                  disabled={state.pending}
                  onChange={(event) => {
                    setRunId(event.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                  className="w-full rounded-lg border border-[#303034] bg-transparent p-2"
                />
              </label>
              <BuiButton
                tone="accent"
                disabled={!issue.trim() || state.pending}
                onClick={() =>
                  void controller
                    .create({ requestId, issue, ...(runId.trim() ? { runId: runId.trim() } : {}) })
                    .then((ok) => {
                      if (ok) {
                        setIssue("");
                        setRunId("");
                        setRequestId(crypto.randomUUID());
                      }
                    })
                }
              >
                Submit issue
              </BuiButton>
              {!draftSaved && issue ? (
                <p role="alert">Keep this window open; the draft could not be saved.</p>
              ) : null}
            </BuiCard>
            {state.data.jobs.map((job) => (
              <BuiCard key={job.id} className="space-y-4 p-5" data-testid="maintenance-job">
                <div className="flex flex-wrap justify-between gap-3">
                  <h2 className="whitespace-pre-wrap font-medium">{job.issue}</h2>
                  <span className="text-sm text-[#A8A8AD]">{job.status}</span>
                </div>
                <p role="status" className="text-sm">
                  {job.message}
                </p>
                {job.runId ? (
                  <p className="break-all text-xs text-[#A8A8AD]">Run: {job.runId}</p>
                ) : null}
                {job.review ? (
                  <>
                    <p className="break-all text-xs text-[#A8A8AD]">
                      {job.review.branch} · {job.review.revision}
                    </p>
                    <details>
                      <summary className="cursor-pointer">Review diff</summary>
                      <pre className="mt-3 overflow-x-auto rounded-lg bg-[#101012] p-4 text-xs">
                        {job.review.diff}
                      </pre>
                    </details>
                    <ul className="space-y-1 text-sm">
                      {job.review.checks.map((check, index) => (
                        <li key={`${index}:${check.name}`}>
                          {check.passed ? "Passed" : "Failed"} · {check.name}
                        </li>
                      ))}
                    </ul>
                    {job.review.release ? (
                      <details>
                        <summary className="cursor-pointer">Release manifest</summary>
                        <dl className="mt-3 space-y-2 break-all text-xs text-[#A8A8AD]">
                          <dt>Manifest</dt>
                          <dd>{job.review.release.manifestHash}</dd>
                          <dt>Prepared image</dt>
                          <dd>{job.review.release.imageId}</dd>
                          <dt>Test evidence</dt>
                          <dd>{job.review.release.evidenceHash}</dd>
                        </dl>
                      </details>
                    ) : null}
                    <p className="text-sm">{job.review.previewSummary}</p>
                    {job.review.previewUrl ? (
                      <a
                        href={job.review.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#C4B5FD]"
                      >
                        Open private preview
                      </a>
                    ) : null}
                    {maintenanceCanApprove(job) ? (
                      confirmJob?.id === job.id && confirmJob.reviewKey === job.reviewKey ? (
                        <div className="space-y-3 rounded-xl border border-[#514265] p-4">
                          <p className="break-all text-sm">
                            {job.simulated ? "Simulate approval of" : "Deploy tested revision"}{" "}
                            {job.review.revision}?
                          </p>
                          <div className="flex gap-2">
                            <BuiButton
                              disabled={state.pending}
                              tone="accent"
                              onClick={() =>
                                void controller.approve(confirmJob).then(() => setConfirmJob(null))
                              }
                            >
                              {job.simulated ? "Confirm simulated release" : "Confirm deployment"}
                            </BuiButton>
                            <BuiButton onClick={() => setConfirmJob(null)}>Go back</BuiButton>
                          </div>
                        </div>
                      ) : (
                        <BuiButton disabled={state.pending} onClick={() => setConfirmJob(job)}>
                          {job.simulated ? "Approve simulated release" : "Approve tested revision"}
                        </BuiButton>
                      )
                    ) : null}
                  </>
                ) : null}
                {job.status === "completed" ? (
                  <p className="text-sm text-[#A8A8AD]">{maintenanceUpdateAdvice(job)}</p>
                ) : null}
                {["queued", "investigating", "review", "blocked", "failed"].includes(job.status) ? (
                  <BuiButton
                    disabled={state.pending}
                    onClick={() => void controller.cancel(job.id)}
                  >
                    Cancel job
                  </BuiButton>
                ) : null}
              </BuiCard>
            ))}
          </>
        ) : null}
      </div>
    </main>
  );
}
