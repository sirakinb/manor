import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceActivity, WorkspaceOverview, WorkspaceSummary } from "@rakazo/contracts";
import { BotAvatar } from "@rakazo/ui-web";
import { ArrowUpRight, BookOpen, ChevronDown } from "lucide-react";
import { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { BuiButton } from "../../../components/beautiful-ui/primitives";
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
    <div className="ws-refined">
      <PageHeader eyebrow={eyebrow} title={t`Your AI team`} />
      {error ? <ErrorLine message={error} /> : null}
      <div className="space-y-4">
        <Card
          title={t`Bots`}
          right={<span className="text-[12px] text-[#A6A6AD]">{team?.bots.length ?? 0}</span>}
        >
          {!team?.bots.length ? (
            <Empty>
              <Trans>Ask the team to start with a workspace assistant.</Trans>
            </Empty>
          ) : (
            <ul className="divide-y divide-[#25282B]">
              {team.bots.map((bot) => (
                <li
                  key={bot.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-1 last:pb-1"
                >
                  <BotAvatar identity={bot.id} color={bot.color} size={40} status={bot.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-[#ECECEE]">{bot.name}</p>
                    {bot.title ? (
                      <p className="mt-1 text-[12px] text-[#85858A]">{bot.title}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 px-2 py-2 text-[12px] text-[#A6A6AD] ${CLICKABLE_TEXT}`}
                    aria-expanded={knowledgeBotId === bot.id}
                    aria-controls="workspace-bot-knowledge"
                    onClick={() => setKnowledgeBotId(knowledgeBotId === bot.id ? null : bot.id)}
                  >
                    <span className="sr-only sm:not-sr-only">
                      <Trans>Knowledge</Trans>
                    </span>
                    <BookOpen size={16} className="sm:hidden" />
                    <ChevronDown
                      size={13}
                      className={`hidden sm:block ${knowledgeBotId === bot.id ? "rotate-180" : ""}`}
                    />
                  </button>
                  <BuiButton
                    disabled={team.busy}
                    onClick={() => team.ask(t`workspace operations`, bot.id)}
                  >
                    <span className="flex items-center gap-2">
                      <Trans>Chat</Trans>
                      <ArrowUpRight size={13} />
                    </span>
                  </BuiButton>
                </li>
              ))}
            </ul>
          )}
          {knowledgeBotId ? (
            <div id="workspace-bot-knowledge" className="mt-4 border-t border-[#25282B] pt-2">
              <KnowledgeSection key={knowledgeBotId} botId={knowledgeBotId} />
              <SpaceMemorySection />
            </div>
          ) : null}
        </Card>
        <AutomationsCard platformOnly />
        <Link
          to="/app/workspace/reports"
          className="flex items-center justify-between gap-4 rounded-xl border border-[#25282B] px-4 py-3.5 text-[13px] text-[#C9C9CE] transition-colors hover:bg-[#181C1E] focus-visible:outline-2 focus-visible:outline-[#70B8AA]"
        >
          <span>
            <span className="block font-medium text-[#ECECEE]">
              <Trans>Reports</Trans>
            </span>
            <span className="mt-0.5 block text-[12px] text-[#A6A6AD]">
              <Trans>Recaps, recipients and schedules</Trans>
            </span>
          </span>
          <ArrowUpRight size={16} />
        </Link>
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
                <p className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-[var(--ws-muted,#6E6975)]">
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
