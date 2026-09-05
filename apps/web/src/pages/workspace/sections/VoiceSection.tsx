import { Trans, useLingui } from "@lingui/react/macro";
import type {
  VoiceAgentType,
  VoiceCallDetail,
  VoiceCallRow,
  WorkspaceSummary,
} from "@rakazo/contracts";
import { useMemo, useState } from "react";
import { rpc } from "../../../lib/rpc";
import {
  Card,
  CLICKABLE_TEXT,
  ErrorLine,
  formatDateTime,
  formatNumber,
  formatPct,
  KpiTile,
  Loading,
  PageHeader,
  Section,
  Segmented,
  StackedBars,
  StatusPill,
  Table,
  useSectionData,
} from "../bits";
import type { WorkspaceTab } from "../WorkspaceView";

type Range = "7" | "30" | "90" | "month";

function daysFor(range: Range): number {
  if (range === "month") return Math.max(1, new Date().getDate());
  return Number(range);
}

/** Sources send "N/A" or nothing when the caller was not identified. */
function callerLabel(name: string | null, fallback: string): string {
  const trimmed = name?.trim() ?? "";
  return trimmed === "" || /^(n\/?a|unknown|none|null)$/i.test(trimmed) ? fallback : trimmed;
}

export function VoiceSection({
  workspace,
  eyebrow,
  callId,
  onOpen,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
  callId?: string;
  onOpen: (tab: WorkspaceTab, id?: string) => void;
}) {
  const { t } = useLingui();
  const [agentType, setAgentType] = useState<VoiceAgentType>("tenant");
  const [range, setRange] = useState<Range>("30");
  const [search, setSearch] = useState("");
  const days = daysFor(range);

  const { data, error, loading } = useSectionData(
    () =>
      Promise.all([
        rpc.workspace.voice.stats({ days, agentType }),
        rpc.workspace.voice.calls({ days, agentType, limit: 200 }),
      ]).then(([stats, calls]) => ({ stats, calls: calls.calls })),
    `${agentType}:${days}`,
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return data.calls;
    return data.calls.filter((call) =>
      [call.callerName, call.callerPhone, call.summary].some((field) =>
        field?.toLowerCase().includes(needle),
      ),
    );
  }, [data, search]);

  if (callId) return <CallDetail callId={callId} onBack={() => onOpen("voice")} />;

  const rangeLabel: Record<Range, string> = {
    "7": t`Last 7 days`,
    "30": t`Last 30 days`,
    "90": t`Last 90 days`,
    month: t`This month`,
  };
  const audience = agentType === "tenant" ? t`Prospective & current tenants` : t`Property owners`;

  const stats = data?.stats;
  const busiest = stats?.daily.reduce<{ day: string; calls: number } | null>(
    (best, day) => (!best || day.calls > best.calls ? day : best),
    null,
  );
  const perDay = stats && stats.windowDays > 0 ? stats.totalCalls / stats.windowDays : 0;
  const share = (part: number) =>
    stats && stats.totalCalls > 0 ? formatPct((part / stats.totalCalls) * 100) : "—";

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={t`Voice`}
        subtitle={`${workspace.name} · ${audience} · ${rangeLabel[range]}`}
      >
        <Segmented
          label={t`Audience`}
          value={agentType}
          onChange={setAgentType}
          options={[
            { key: "tenant", label: t`Tenants` },
            { key: "landlord", label: t`Landlords` },
          ]}
        />
        <Segmented
          label={t`Range`}
          value={range}
          onChange={setRange}
          options={[
            { key: "7", label: t`Last 7 days` },
            { key: "30", label: t`Last 30 days` },
            { key: "90", label: t`Last 90 days` },
            { key: "month", label: t`This month` },
          ]}
        />
      </PageHeader>

      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data && stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile
              label={t`Total calls`}
              value={formatNumber(stats.totalCalls)}
              delta={stats.deltaPct.totalCalls}
              caption={t`${perDay.toFixed(perDay < 10 ? 1 : 0)}/day avg`}
            />
            <KpiTile
              label={t`AI handled`}
              value={formatNumber(stats.aiHandled)}
              delta={stats.deltaPct.aiHandled}
              caption={t`${share(stats.aiHandled)} of calls`}
            />
            <KpiTile
              label={t`Callbacks requested`}
              value={formatNumber(stats.callbacksRequested)}
              delta={stats.deltaPct.callbacksRequested}
              caption={t`${share(stats.callbacksRequested)} of calls`}
            />
            <KpiTile
              label={t`Busiest day`}
              value={busiest ? formatNumber(busiest.calls) : "—"}
              caption={busiest ? t`calls on ${busiest.day}` : t`calls in a single day`}
            />
          </div>

          <Card title={t`Call volume`} className="mt-4">
            <StackedBars
              legend={{ primary: t`AI handled`, secondary: t`Other` }}
              bars={stats.daily.map((day) => ({
                label: day.day.slice(5),
                primary: day.aiHandled,
                secondary: Math.max(0, day.calls - day.aiHandled),
                title: `${day.day} · ${formatNumber(day.calls)} ${t`calls`} · ${formatNumber(day.aiHandled)} ${t`AI handled`}`,
              }))}
            />
          </Card>

          <Card
            className="mt-4"
            title={
              <span>
                <Trans>Calls</Trans>{" "}
                <span className="font-normal text-[#6E6975]">{t`${formatNumber(filtered.length)} in range`}</span>
              </span>
            }
            right={
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t`Search caller, phone, summary…`}
                aria-label={t`Search calls`}
                className="w-[260px] rounded-lg border border-[#202023] bg-[#0D0D0E] px-3 py-1.5 text-[12.5px] text-[#C9C9CE] outline-none placeholder:text-[#5F5B69] focus:border-[#34343B]"
              />
            }
          >
            <Table<VoiceCallRow>
              rows={filtered}
              rowKey={(call) => call.id}
              onRowClick={(call) => onOpen("voice", call.id)}
              emptyLabel={t`No calls in this range`}
              columns={[
                {
                  key: "caller",
                  label: t`Caller`,
                  render: (call) => (
                    <span className="font-medium text-[#ECECEE]">
                      {callerLabel(call.callerName, t`Unknown caller`)}
                    </span>
                  ),
                },
                {
                  key: "phone",
                  label: t`Phone`,
                  nowrap: true,
                  render: (call) => call.callerPhone ?? "—",
                },
                {
                  key: "when",
                  label: t`When`,
                  nowrap: true,
                  render: (call) => formatDateTime(call.callStartedAt),
                },
                {
                  key: "ai",
                  label: t`AI`,
                  render: (call) =>
                    call.aiResolved === null ? (
                      "—"
                    ) : call.aiResolved ? (
                      <StatusPill tone="good">{t`Handled`}</StatusPill>
                    ) : (
                      <StatusPill tone="dim">{t`Escalated`}</StatusPill>
                    ),
                },
                {
                  key: "callback",
                  label: t`Callback`,
                  render: (call) =>
                    call.callbackRequested ? (
                      <StatusPill tone="warn">{t`Requested`}</StatusPill>
                    ) : (
                      "—"
                    ),
                },
                {
                  key: "summary",
                  label: t`Summary`,
                  width: "38%",
                  render: (call) => (
                    <span className="line-clamp-2 text-[#A6A6AD]">{call.summary ?? "—"}</span>
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}

function CallDetail({ callId, onBack }: { callId: string; onBack: () => void }) {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData<VoiceCallDetail>(
    () => rpc.workspace.voice.call({ callId }),
    callId,
  );
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className={`mb-3 text-[12.5px] text-[#85858A] ${CLICKABLE_TEXT}`}
      >
        ← <Trans>Voice</Trans>
      </button>
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <PageHeader
            title={callerLabel(data.callerName, t`Unknown caller`)}
            subtitle={[data.callerPhone, formatDateTime(data.callStartedAt)]
              .filter(Boolean)
              .join(" · ")}
          />
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {data.aiResolved !== null ? (
                <StatusPill tone={data.aiResolved ? "good" : "dim"}>
                  {data.aiResolved ? t`AI handled` : t`Needed a person`}
                </StatusPill>
              ) : null}
              {data.callbackRequested ? (
                <StatusPill tone="warn">{t`Callback requested`}</StatusPill>
              ) : null}
              {data.followUpRequired ? (
                <StatusPill tone="warn">{t`Follow-up required`}</StatusPill>
              ) : null}
              {data.sentiment ? <StatusPill tone="accent">{data.sentiment}</StatusPill> : null}
              {data.durationSeconds !== null ? (
                <StatusPill tone="dim">{t`${Math.round(data.durationSeconds / 60)} min`}</StatusPill>
              ) : null}
            </div>
            <Section title={t`Summary`}>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#C9C9CE]">
                {data.summary ?? "—"}
              </p>
            </Section>
            {data.callReason ? (
              <Section title={t`Reason`}>
                <p className="text-[13px] text-[#C9C9CE]">{data.callReason}</p>
              </Section>
            ) : null}
            {data.aiResolutionNotes ? (
              <Section title={t`Resolution notes`}>
                <p className="whitespace-pre-wrap text-[13px] text-[#C9C9CE]">
                  {data.aiResolutionNotes}
                </p>
              </Section>
            ) : null}
            {data.tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {data.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[#1A1A1D] px-2 py-0.5 text-[11px] text-[#A6A6AD]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            {data.recordingUrl ? (
              <a
                href={data.recordingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-[12.5px] text-[#A6A6AD] underline hover:text-[#ECECEE]"
              >
                <Trans>Open recording</Trans>
              </a>
            ) : null}
            {data.transcript ? (
              <Section title={t`Transcript`}>
                <pre className="rk-scroll max-h-[520px] overflow-auto whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-[#A6A6AD]">
                  {data.transcript}
                </pre>
              </Section>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
