import { Trans, useLingui } from "@lingui/react/macro";
import type {
  WorkspaceActivity,
  WorkspaceOverview,
  WorkspaceSummary,
  WorkspaceTeamWorker,
} from "@rakazo/contracts";
import { useState } from "react";
import { rpc } from "../../../lib/rpc";
import { AutomationsCard } from "../AutomationsCard";
import {
  Card,
  CLICKABLE_TEXT,
  CountPill,
  Empty,
  ErrorLine,
  formatAgo,
  formatDateTime,
  Loading,
  PageHeader,
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

export function TeamSection({
  workspace,
  eyebrow,
  overview,
  error,
  onRefresh,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
  overview: WorkspaceOverview | null;
  error: string | null;
  onRefresh: () => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const [more, setMore] = useState<WorkspaceActivity[] | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const workerLabel: Record<WorkspaceTeamWorker["status"], string> = {
    working: t`Syncing now`,
    fresh: t`Up to date`,
    catching_up: t`Catching up`,
    setting_up: t`Setting up`,
  };
  const verificationLabel: Record<WorkspaceActivity["verification"], string> = {
    approved: t`Approved`,
    auto: t`Auto`,
    pending: t`Needs review`,
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
  const dayAgo = Date.now() - 24 * 3_600_000;
  const activeToday =
    overview?.team.filter((worker) => worker.lastAt && new Date(worker.lastAt).getTime() > dayAgo)
      .length ?? 0;
  const pending = activity.filter((entry) => entry.verification === "pending").length;

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={t`Your AI team`}
        subtitle={t`${workspace.name} · connected workers, what they've done, and what's running now`}
      >
        <StatusPill tone="dim">
          {workspace.activityApproval === "auto" ? t`Approvals: auto` : t`Approvals: manual`}
        </StatusPill>
      </PageHeader>
      {!overview && error ? <ErrorLine message={error} /> : null}
      {!overview && !error ? <Loading /> : null}
      {overview ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <CountPill count={activeToday} label={t`active today`} tone="good" />
            <CountPill count={pending} label={t`need review`} tone="warn" />
          </div>
          {overview.team.length === 0 ? (
            <Empty>
              <Trans>No workers yet</Trans>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {overview.team.map((worker) => (
                <div
                  key={worker.key}
                  className="relative overflow-hidden rounded-xl border border-[#202023] bg-[#131315] p-4"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-2 right-3 select-none text-[56px] font-semibold tracking-tight text-[#1A1A1D]"
                  >
                    {initials(worker.name)}
                  </span>
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-[#ECECEE]">
                        {worker.name}
                      </p>
                      <p className="mt-1 text-[12.5px] leading-snug text-[#85858A]">
                        {worker.role}
                      </p>
                    </div>
                    <span className="shrink-0 rounded border border-[#2A2A2F] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[#6E6975]">
                      <Trans>Always on</Trans>
                    </span>
                  </div>
                  <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-[#1C1C1F] pt-3 text-[11px] uppercase tracking-[0.08em]">
                    <span className="flex items-center gap-2">
                      <StatusPill tone={WORKER_TONE[worker.status]}>
                        {workerLabel[worker.status]}
                      </StatusPill>
                      {worker.lastAt ? (
                        <span className="text-[#6E6975]">
                          {formatAgo(worker.lastAt, i18n.locale)}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[#6E6975]">{worker.cadence}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <AutomationsCard />
          </div>

          <Card
            className="mt-4"
            title={t`Recent activity`}
            subtitle={t`What the team logged, newest first`}
            right={
              <button
                type="button"
                onClick={() => void onRefresh()}
                className={`text-[12px] text-[#85858A] ${CLICKABLE_TEXT}`}
              >
                <Trans>Refresh</Trans>
              </button>
            }
          >
            {activity.length === 0 ? (
              <Empty>
                <Trans>Nothing logged yet</Trans>
              </Empty>
            ) : (
              <ul className="divide-y divide-[#1C1C1F]">
                {activity.map((entry) => (
                  <li key={entry.id} className="py-2.5">
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
                className={`mt-3 text-[12.5px] text-[#85858A] disabled:opacity-60 ${CLICKABLE_TEXT}`}
              >
                <Trans>Show more</Trans>
              </button>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}
