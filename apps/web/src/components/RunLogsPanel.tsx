import { Trans, useLingui } from "@lingui/react/macro";
import { RunLogsController } from "@rakazo/core";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { rpc } from "../lib/rpc";
import { BuiButton, BuiCard, LoadingState } from "./beautiful-ui/primitives";

export function RunLogsPanel({
  botId,
  isDeploymentOwner = false,
}: {
  botId: string;
  isDeploymentOwner?: boolean;
}) {
  const { t } = useLingui();
  const controller = useMemo(() => new RunLogsController(botId, rpc.runs), [botId]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  const data = state.data;
  return (
    <section
      data-testid="run-logs"
      aria-label={t`Run logs`}
      className="min-w-0 space-y-4 text-[13px]"
    >
      <div className="flex flex-wrap gap-2">
        <BuiButton onClick={() => void controller.refresh()}>
          <Trans>Refresh</Trans>
        </BuiButton>
        <BuiButton
          disabled={!data}
          onClick={() => {
            if (data)
              void navigator.clipboard
                .writeText(JSON.stringify(data, null, 2))
                .then(() => setCopyStatus(t`Copied`))
                .catch(() => setCopyStatus(t`Could not copy logs`));
          }}
        >
          <Trans>Copy diagnostics</Trans>
        </BuiButton>
        {isDeploymentOwner && data ? (
          <a
            href={`/app/maintenance?runId=${encodeURIComponent(data.run.id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full px-4 py-2 text-[#C4B5FD]"
          >
            <Trans>Report issue</Trans>
          </a>
        ) : null}
        <span role="status">{copyStatus}</span>
      </div>
      {state.error ? (
        <p role="alert" className="text-[#F3A59B]">
          <Trans>Could not refresh run logs. Try again.</Trans>
        </p>
      ) : null}
      {state.loading ? <LoadingState label={t`Loading run logs…`} /> : null}
      {!state.loading && !state.runs.length && !state.error ? (
        <p>
          <Trans>No runs yet.</Trans>
        </p>
      ) : null}
      {state.runs.length ? (
        <label className="block space-y-2">
          <span>
            <Trans>Run</Trans>
          </span>
          <select
            aria-label={t`Run`}
            value={state.selectedId ?? ""}
            onChange={(event) => {
              setCopyStatus(null);
              controller.select(event.target.value);
            }}
            className="w-full min-w-0 rounded-lg border border-[#303034] bg-[#17171A] p-2"
          >
            {state.runs.map((run) => (
              <option key={run.id} value={run.id}>
                {new Date(run.createdAt).toLocaleString()} · {run.trigger} · {run.status}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {data ? (
        <>
          <BuiCard className="space-y-2 p-4">
            <p className="font-medium" data-testid="run-log-status">
              {data.run.status}
            </p>
            <p className="break-all font-mono text-xs">
              <Trans>Run ID</Trans>: {data.run.id}
            </p>
            <p className="break-words">
              {[data.run.modelProvider, data.run.modelId].filter(Boolean).join(" / ")}
            </p>
            <p>
              <Trans>Started</Trans>:{" "}
              {data.run.startedAt ? new Date(data.run.startedAt).toLocaleString() : "—"}
            </p>
            {data.run.completedAt ? (
              <p>
                <Trans>Finished</Trans>: {new Date(data.run.completedAt).toLocaleString()}
              </p>
            ) : null}
            {data.run.error ? <p className="text-[#F3A59B]">{data.run.error}</p> : null}
            {data.failure ? (
              <p>
                <Trans>Failure stage</Trans>: {data.failure.stage}
              </p>
            ) : null}
          </BuiCard>
          {data.attempts.length ? (
            <details>
              <summary className="cursor-pointer">
                <Trans>Attempts</Trans> ({data.attempts.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {data.attempts.map((attempt, index) => (
                  <li key={`${attempt.startedAt}:${index}`}>
                    {new Date(attempt.startedAt).toLocaleTimeString()} · {attempt.status}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {data.olderCursor !== null ? (
            <BuiButton disabled={state.loadingOlder} onClick={() => void controller.loadOlder()}>
              <Trans>Load earlier events</Trans>
            </BuiButton>
          ) : null}
          <ol className="space-y-2" aria-label={t`Run events`}>
            {data.events.map((event) => (
              <li key={event.id} className="flex gap-3 border-b border-[#222226] pb-2">
                <time
                  className="shrink-0 font-mono text-xs text-[#A8A8AD]"
                  dateTime={event.createdAt}
                >
                  {new Date(event.createdAt).toLocaleTimeString()}
                </time>
                <div className="min-w-0 break-words">
                  <span>{event.tool ?? event.type}</span>
                  {event.tool ? (
                    <span
                      className={event.status === "failed" ? "text-[#F3A59B]" : "text-[#A8A8AD]"}
                    >
                      {" "}
                      · {event.status ?? t`started`}
                    </span>
                  ) : null}
                  {event.durationMs !== null ? (
                    <span className="text-[#A8A8AD]">
                      {" "}
                      · {(event.durationMs / 1000).toFixed(1)}s
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-[#A8A8AD]">
            <Trans>Diagnostics exclude prompts, credentials, tool inputs and outputs.</Trans>
          </p>
        </>
      ) : null}
    </section>
  );
}
