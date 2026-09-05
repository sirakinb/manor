import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceActivity, WorkspaceOverview, WorkspaceSummary } from "@rakazo/contracts";
import { useContext, useState } from "react";
import { BuiButton, BuiCard } from "../../../components/beautiful-ui/primitives";
import { rpc } from "../../../lib/rpc";
import { KnowledgeSection, SpaceMemorySection } from "../../KnowledgeSection";
import { WorkspaceTeamContext } from "../AskTeam";
import { AutomationsCard } from "../AutomationsCard";
import {
  Card,
  CLICKABLE_TEXT,
  Empty,
  ErrorLine,
  formatDateTime,
  PageHeader,
  StatusPill,
} from "../bits";

export function TeamSection({
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
  const { t } = useLingui();
  const team = useContext(WorkspaceTeamContext);
  const [more, setMore] = useState<WorkspaceActivity[] | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [knowledgeBotId, setKnowledgeBotId] = useState<string | null>(null);
  const activity = more ?? overview?.recentActivity ?? [];
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
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={t`Your AI team`} />
      {error ? <ErrorLine message={error} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t`Bots`}>
          {!team?.bots.length ? (
            <Empty>
              <Trans>Ask the team to start with a workspace assistant.</Trans>
            </Empty>
          ) : (
            <div className="space-y-3">
              {team.bots.map((bot) => (
                <BuiCard key={bot.id} className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-[#ECECEE]">{bot.name}</p>
                      {bot.title ? (
                        <p className="mt-1 text-[12px] text-[#85858A]">{bot.title}</p>
                      ) : null}
                    </div>
                    <BuiButton
                      disabled={team.busy}
                      onClick={() => team.ask(t`workspace operations`, bot.id)}
                    >
                      <Trans>Chat</Trans>
                    </BuiButton>
                  </div>
                  <button
                    type="button"
                    className={`mt-3 text-[12px] text-[#A6A6AD] ${CLICKABLE_TEXT}`}
                    aria-expanded={knowledgeBotId === bot.id}
                    onClick={() => setKnowledgeBotId(knowledgeBotId === bot.id ? null : bot.id)}
                  >
                    <Trans>Knowledge</Trans>
                  </button>
                  {knowledgeBotId === bot.id ? (
                    <div>
                      <KnowledgeSection botId={bot.id} />
                      <SpaceMemorySection />
                    </div>
                  ) : null}
                </BuiCard>
              ))}
            </div>
          )}
        </Card>
        <AutomationsCard />
      </div>
      <Card
        className="mt-4"
        title={t`Recent activity`}
        right={
          <button
            type="button"
            onClick={() => {
              setMore(null);
              void onRefresh();
            }}
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
                  <StatusPill
                    tone={
                      entry.verification === "pending"
                        ? "warn"
                        : entry.verification === "rejected"
                          ? "bad"
                          : "good"
                    }
                  >
                    {entry.verification === "pending"
                      ? t`Needs review`
                      : entry.verification === "approved"
                        ? t`Approved`
                        : entry.verification === "rejected"
                          ? t`Rejected`
                          : t`Auto`}
                  </StatusPill>
                </div>
                {entry.summary ? (
                  <p className="mt-1 line-clamp-2 text-[12.5px] text-[#A6A6AD]">{entry.summary}</p>
                ) : null}
                <p className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-[#6E6975]">
                  <span>{entry.channel}</span>
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
    </div>
  );
}
