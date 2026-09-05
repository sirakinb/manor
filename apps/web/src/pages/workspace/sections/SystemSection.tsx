import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspacePipe, WorkspaceSummary } from "@rakazo/contracts";
import { accentColor } from "../../../lib/brand";
import { rpc } from "../../../lib/rpc";
import { useRunAutomation } from "../AutomationsCard";
import {
  CLICKABLE_TEXT,
  CountPill,
  Empty,
  ErrorLine,
  formatDateTime,
  formatNumber,
  Loading,
  PageHeader,
  PIPE_COLORS,
  pipeTone,
  StatusPill,
  useFormatAgeHours,
  useSectionData,
} from "../bits";
import { VaultGlyph } from "../PipelineMap";

const RUN_COLORS: Record<string, string> = {
  success: "#4ADE80",
  error: "#F87171",
  running: "#E8A33C",
};

export function SystemSection({
  workspace,
  eyebrow,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
}) {
  const { t } = useLingui();
  const formatAgeHours = useFormatAgeHours();
  const { data, error, loading, reload } = useSectionData(
    () =>
      Promise.all([rpc.workspace.system(), rpc.workspace.automations.list()]).then(
        ([system, automations]) => ({ pipes: system.pipes, automations }),
      ),
    "system",
  );
  const runner = useRunAutomation(reload);
  const nextRunFor = (key: string | null) =>
    key
      ? (data?.automations.find((automation) => automation.key === key)?.nextRunAt ?? null)
      : null;
  const statusLabel: Record<WorkspacePipe["status"], string> = {
    flowing: t`Flowing`,
    overdue: t`Failing`,
    failing: t`Failing`,
    idle: t`Idle`,
  };
  const count = (status: WorkspacePipe["status"]) =>
    data?.pipes.filter((pipe) => pipe.status === status).length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={t`System`}
        subtitle={t`Pipeline health for ${workspace.name} · every pipe feeds this workspace's private data vault`}
      >
        {data ? (
          <>
            <CountPill count={count("flowing")} label={t`flowing`} tone="accent" />
            <CountPill count={count("failing") + count("overdue")} label={t`failing`} tone="bad" />
          </>
        ) : null}
      </PageHeader>
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <div className="rounded-xl border border-[#202023] bg-[#131315] p-4">
          {data.pipes.length === 0 ? (
            <Empty>
              <Trans>No pipes configured</Trans>
            </Empty>
          ) : (
            <div className="flex gap-6">
              <ul className="min-w-0 flex-1 divide-y divide-[#1C1C1F]">
                {data.pipes.map((pipe) => {
                  const color = PIPE_COLORS[pipe.status];
                  return (
                    <li
                      key={pipe.key}
                      className="grid grid-cols-[minmax(160px,1fr)_minmax(0,2.2fr)_auto] items-center gap-5 py-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-[#ECECEE]">
                          {pipe.label}
                        </p>
                        <p className="truncate text-[12px] text-[#6E6975]">
                          {pipe.source} · {pipe.cadence}
                        </p>
                        {pipe.automationKey ? (
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-[#6E6975]">
                            {nextRunFor(pipe.automationKey) ? (
                              <span>{t`Next ${formatDateTime(nextRunFor(pipe.automationKey))}`}</span>
                            ) : null}
                            {runner.queued.has(pipe.automationKey) ? (
                              <StatusPill tone="accent">{t`Queued`}</StatusPill>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void runner.run(pipe.automationKey!)}
                                className={`text-[#A6A6AD] ${CLICKABLE_TEXT}`}
                              >
                                <Trans>Run now</Trans>
                              </button>
                            )}
                            {runner.errors[pipe.automationKey] ? (
                              <span className="text-[#E8A33C]">
                                {runner.errors[pipe.automationKey]}
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div
                          className={`rk-signal h-3 rounded-full ${pipe.status === "flowing" ? "rk-signal-flowing" : pipe.status === "overdue" ? "rk-signal-overdue" : ""}`}
                          style={{ "--rk-signal-color": color } as React.CSSProperties}
                          role="img"
                          aria-label={`${statusLabel[pipe.status]} · ${formatAgeHours(pipe.ageHours)}`}
                        />
                        <div className="mt-1.5 flex items-center justify-between gap-3">
                          <span className="text-[10px] uppercase tracking-[0.1em] text-[#6E6975]">
                            <Trans>Freshness signal</Trans>
                          </span>
                          {pipe.runs.length ? (
                            <span className="flex gap-0.5" role="img" aria-label={t`Recent runs`}>
                              {pipe.runs.map((run, index) => (
                                <span
                                  key={`${run.startedAt}-${index}`}
                                  title={`${run.status} · ${formatDateTime(run.startedAt)}${run.recordsLoaded !== null ? ` · ${formatNumber(run.recordsLoaded)}` : ""}${run.errorMessage ? ` · ${run.errorMessage}` : ""}`}
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: RUN_COLORS[run.status] ?? "#3A3A40" }}
                                />
                              ))}
                            </span>
                          ) : null}
                        </div>
                        {pipe.lastError ? (
                          <p className="mt-1 line-clamp-1 text-[11.5px] text-[#F87171]">
                            {pipe.lastError}
                          </p>
                        ) : null}
                      </div>
                      <div className="w-[104px] text-right">
                        <StatusPill tone={pipeTone(pipe.status)}>
                          {statusLabel[pipe.status]}
                        </StatusPill>
                        <p className="mt-1 text-[11.5px] text-[#6E6975] tabular-nums">
                          {pipe.status === "overdue"
                            ? t`no new data for ${formatAgeHours(pipe.ageHours)}`
                            : pipe.lastAt
                              ? t`${formatAgeHours(pipe.ageHours)} ago`
                              : t`no data`}
                          {pipe.status !== "overdue" && pipe.lastRecords !== null
                            ? ` · ${formatNumber(pipe.lastRecords)}`
                            : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div
                className="hidden w-[72px] shrink-0 flex-col items-center md:flex"
                aria-hidden="true"
              >
                <div
                  className="rk-signal rk-signal-vertical rk-signal-flowing w-3 flex-1 rounded-full"
                  style={{ "--rk-signal-color": accentColor } as React.CSSProperties}
                />
                <svg width="72" height="84" viewBox="0 0 72 84" className="mt-1">
                  <VaultGlyph x={8} y={2} color={accentColor} size={56} />
                  <text
                    x="36"
                    y="80"
                    fontSize="8"
                    fontWeight="600"
                    letterSpacing="0.12em"
                    textAnchor="middle"
                    fill="#85858A"
                  >
                    {t`DATA VAULT`}
                  </text>
                </svg>
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#1C1C1F] pt-3 text-[11.5px] text-[#6E6975]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">
              <Trans>Legend</Trans>
            </span>
            <LegendSwatch color={PIPE_COLORS.flowing} label={t`flowing`} />
            <LegendSwatch color={PIPE_COLORS.failing} label={t`failing (last run failed)`} />
            <LegendSwatch color={PIPE_COLORS.overdue} label={t`failing (no new data)`} />
            <LegendSwatch color={PIPE_COLORS.idle} label={t`idle (no data)`} />
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: RUN_COLORS.success }}
              />
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: RUN_COLORS.error }}
              />
              <Trans>run history, oldest → newest</Trans>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
