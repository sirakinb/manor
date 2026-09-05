import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceAutomation } from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import { rpc } from "../../lib/rpc";
import {
  Card,
  CLICKABLE_TEXT,
  Empty,
  ErrorLine,
  errorMessage,
  formatAgo,
  formatDateTime,
  formatNumber,
  Loading,
  pipeTone,
  StatusPill,
  Toggle,
  useCronWords,
  useSectionData,
} from "./bits";

/** Milliseconds between "Run now" and the refetch that shows the run. */
const REFRESH_AFTER_RUN_MS = 2500;

/**
 * Queue a run for one automation. `queued` holds until the refetch the hook
 * schedules; errors (including the owner-only refusal) come back per key.
 */
export function useRunAutomation(reload: () => void) {
  const [queued, setQueued] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timers = useRef<number[]>([]);
  const { t } = useLingui();
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );
  return {
    queued,
    errors,
    run: async (key: string) => {
      setErrors((current) => ({ ...current, [key]: "" }));
      try {
        await rpc.workspace.automations.run({ key: key as WorkspaceAutomation["key"] });
        setQueued((current) => new Set(current).add(key));
        timers.current.push(
          window.setTimeout(() => {
            setQueued((current) => {
              const next = new Set(current);
              next.delete(key);
              return next;
            });
            reload();
          }, REFRESH_AFTER_RUN_MS),
        );
      } catch (cause) {
        setErrors((current) => ({ ...current, [key]: errorMessage(cause, t`Could not run`) }));
      }
    },
  };
}

export function AutomationsCard({ platformOnly = false }: { platformOnly?: boolean }) {
  const { t } = useLingui();
  const cronWords = useCronWords();
  const { data, error, loading, reload, setData } = useSectionData(
    () => rpc.workspace.automations.list(),
    "automations",
  );
  const runner = useRunAutomation(reload);
  const automations = data?.filter(
    (automation) => !platformOnly || !automation.key.includes("recap"),
  );
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});
  const statusLabel: Record<WorkspaceAutomation["status"], string> = {
    flowing: t`Flowing`,
    overdue: t`Overdue`,
    failing: t`Failing`,
    idle: t`Idle`,
  };

  async function toggle(automation: WorkspaceAutomation) {
    setToggleErrors((current) => ({ ...current, [automation.key]: "" }));
    try {
      const next = await rpc.workspace.automations.update({
        key: automation.key,
        enabled: !automation.enabled,
      });
      setData((data ?? []).map((row) => (row.key === next.key ? next : row)));
    } catch (cause) {
      setToggleErrors((current) => ({
        ...current,
        [automation.key]: errorMessage(cause, t`Could not update`),
      }));
    }
  }

  return (
    <Card
      className="@container"
      title={platformOnly ? t`Platform syncs` : t`Automations`}
      subtitle={platformOnly ? undefined : t`Scheduled pipelines and their newest run`}
    >
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {automations ? (
        automations.length === 0 ? (
          <Empty>
            <Trans>No automations yet</Trans>
          </Empty>
        ) : (
          <ul className="divide-y divide-[#1C1C1F]" data-testid="workspace-automations">
            {automations.map((automation) => {
              const rowError = runner.errors[automation.key] || toggleErrors[automation.key];
              const lastRun = automation.lastRun;
              return (
                <li
                  key={automation.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 py-3 text-[12.5px] @min-[700px]:grid-cols-[minmax(180px,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-[#ECECEE]">
                        {automation.label}
                      </span>
                      <StatusPill tone="dim">{automation.channel}</StatusPill>
                    </p>
                    <p className="mt-0.5 text-[var(--ws-muted,#6E6975)]">
                      {cronWords(automation.crons)} · {automation.timezone}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2 @min-[700px]:justify-start">
                    <StatusPill tone={automation.enabled ? pipeTone(automation.status) : "dim"}>
                      {automation.enabled ? statusLabel[automation.status] : t`Paused`}
                    </StatusPill>
                  </div>
                  <div className="min-w-0 text-[#85858A]">
                    <p className="truncate">
                      {lastRun ? (
                        <>
                          <span className="text-[#C9C9CE]">{formatAgo(lastRun.startedAt)}</span>
                          {lastRun.errorMessage ? (
                            <span className="text-[#F87171]"> · {lastRun.errorMessage}</span>
                          ) : lastRun.recordsLoaded !== null ? (
                            <span> · {t`${formatNumber(lastRun.recordsLoaded)} records`}</span>
                          ) : (
                            <span> · {lastRun.status}</span>
                          )}
                        </>
                      ) : (
                        t`No runs yet`
                      )}
                    </p>
                    <p className="truncate text-[11.5px] text-[var(--ws-muted,#6E6975)]">
                      {automation.nextRunAt
                        ? t`Next ${formatDateTime(automation.nextRunAt)}`
                        : automation.enabled
                          ? t`Not scheduled`
                          : ""}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    {runner.queued.has(automation.key) ? (
                      <StatusPill tone="accent">{t`Queued`}</StatusPill>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void runner.run(automation.key)}
                        className={`text-[#A6A6AD] ${CLICKABLE_TEXT}`}
                      >
                        <Trans>Run now</Trans>
                      </button>
                    )}
                    <Toggle
                      label={
                        automation.enabled
                          ? t`Pause ${automation.label}`
                          : t`Resume ${automation.label}`
                      }
                      checked={automation.enabled}
                      onChange={() => void toggle(automation)}
                    />
                  </div>
                  {rowError ? (
                    <p className="col-span-full text-[11.5px] text-[#E8A33C]">{rowError}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </Card>
  );
}
