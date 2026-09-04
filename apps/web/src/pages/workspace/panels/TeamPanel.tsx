import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceActivity, WorkspaceOverview, WorkspaceTeamWorker } from "@rakazo/contracts";
import { useState } from "react";
import { rpc } from "../../../lib/rpc";
import {
  Empty,
  ErrorLine,
  formatAgo,
  formatDateTime,
  Loading,
  PanelHeader,
  type PillTone,
  StatusPill,
} from "../bits";

const WORKER_TONE: Record<WorkspaceTeamWorker["status"], PillTone> = {
  working: "accent",
  fresh: "good",
  catching_up: "warn",
  setting_up: "dim",
};

const VERIFICATION_TONE: Record<WorkspaceActivity["verification"], PillTone> = {
  approved: "good",
  auto: "good",
  pending: "warn",
  rejected: "bad",
};

export function TeamPanel({
  overview,
  error,
  onRefresh,
}: {
  overview: WorkspaceOverview | null;
  error: string | null;
  onRefresh: () => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const [more, setMore] = useState<WorkspaceActivity[] | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const workerLabel: Record<WorkspaceTeamWorker["status"], string> = {
    working: t`Working`,
    fresh: t`Up to date`,
    catching_up: t`Catching up`,
    setting_up: t`Setting up`,
  };
  const verificationLabel: Record<WorkspaceActivity["verification"], string> = {
    approved: t`Approved`,
    auto: t`Auto`,
    pending: t`Pending`,
    rejected: t`Rejected`,
  };

  async function loadMore() {
    setLoadingMore(true);
    try {
      setMore(await rpc.workspace.activities.list({ limit: 100 }));
      setMoreError(null);
    } catch (cause) {
      setMoreError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingMore(false);
    }
  }

  const activity = more ?? overview?.recentActivity ?? [];

  return (
    <div>
      <PanelHeader title={t`AI team`} />
      {!overview && error ? <ErrorLine message={error} /> : null}
      {!overview && !error ? <Loading /> : null}
      {overview ? (
        <>
          {overview.team.length === 0 ? (
            <Empty>
              <Trans>No workers yet</Trans>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {overview.team.map((worker) => (
                <div
                  key={worker.key}
                  className="rounded-xl border border-[#202023] bg-[#131315] p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-medium text-[#ECECEE]">
                        {worker.name}
                      </p>
                      <p className="mt-0.5 text-[12px] text-[#85858A]">{worker.role}</p>
                    </div>
                    <StatusPill tone={WORKER_TONE[worker.status]}>
                      {workerLabel[worker.status]}
                    </StatusPill>
                  </div>
                  <p className="mt-2.5 flex flex-wrap gap-x-3 text-[11.5px] text-[#6E6975]">
                    <span className="capitalize">{worker.channel}</span>
                    <span>{worker.cadence}</span>
                    <span>
                      {worker.lastAt
                        ? t`Active ${formatAgo(worker.lastAt, i18n.locale)}`
                        : t`No activity yet`}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-[#ECECEE]">
              <Trans>Recent activity</Trans>
            </h3>
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="text-[12px] text-[#85858A] hover:text-[#ECECEE]"
            >
              <Trans>Refresh</Trans>
            </button>
          </div>
          {activity.length === 0 ? (
            <Empty>
              <Trans>Nothing logged yet</Trans>
            </Empty>
          ) : (
            <ul className="divide-y divide-[#1C1C1F] rounded-xl border border-[#202023]">
              {activity.map((entry) => (
                <li key={entry.id} className="px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#ECECEE]">
                      {entry.title}
                    </p>
                    <StatusPill tone={VERIFICATION_TONE[entry.verification]}>
                      {verificationLabel[entry.verification]}
                    </StatusPill>
                  </div>
                  {entry.summary ? (
                    <p className="mt-1 line-clamp-2 text-[12.5px] text-[#A6A6AD]">
                      {entry.summary}
                    </p>
                  ) : null}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-[#6E6975]">
                    <span className="capitalize">{entry.channel}</span>
                    <span>{entry.kind}</span>
                    <span>{entry.actor}</span>
                    <span>{formatDateTime(entry.createdAt)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
          {moreError ? <ErrorLine message={moreError} /> : null}
          {!more ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mt-3 text-[12.5px] text-[#85858A] hover:text-[#ECECEE] disabled:opacity-60"
            >
              <Trans>Show more</Trans>
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
