import { Trans, useLingui } from "@lingui/react/macro";
import type { VoiceAgentType, VoiceCallDetail, VoiceCallRow, VoiceStats } from "@rakazo/contracts";
import { useMemo, useState } from "react";
import { rpc } from "../../../lib/rpc";
import {
  ErrorLine,
  formatDateTime,
  formatNumber,
  formatPct,
  KpiTile,
  LineChart,
  Loading,
  PanelHeader,
  Section,
  Segmented,
  StatusPill,
  Table,
  useSectionData,
} from "../bits";

type Window = 7 | 30 | 90;

/** Sources send "N/A" or nothing when the caller was not identified. */
function callerLabel(name: string | null, fallback: string): string {
  const trimmed = name?.trim() ?? "";
  return trimmed === "" || /^(n\/?a|unknown|none|null)$/i.test(trimmed) ? fallback : trimmed;
}

export function VoicePanel() {
  const { t } = useLingui();
  const [agentType, setAgentType] = useState<VoiceAgentType>("tenant");
  const [days, setDays] = useState<Window>(30);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<VoiceCallRow | null>(null);

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

  return (
    <div>
      <PanelHeader title={t`Voice`}>
        <Segmented
          label={t`Agent`}
          value={agentType}
          onChange={(next) => {
            setAgentType(next);
            setSelected(null);
          }}
          options={[
            { key: "tenant", label: t`Tenants` },
            { key: "landlord", label: t`Landlords` },
          ]}
        />
        <Segmented
          label={t`Window`}
          value={String(days) as "7" | "30" | "90"}
          onChange={(next) => {
            setDays(Number(next) as Window);
            setSelected(null);
          }}
          options={[
            { key: "7", label: t`7d` },
            { key: "30", label: t`30d` },
            { key: "90", label: t`90d` },
          ]}
        />
      </PanelHeader>

      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        selected ? (
          <CallDetail call={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            <Tiles stats={data.stats} />
            <div className="mt-3">
              <Section title={t`Calls per day`}>
                <LineChart
                  labels={data.stats.daily.map((day) => day.day.slice(5))}
                  series={[
                    {
                      name: t`Calls`,
                      values: data.stats.daily.map((day) => day.calls),
                      area: true,
                    },
                    {
                      name: t`AI handled`,
                      values: data.stats.daily.map((day) => day.aiHandled),
                      color: "#4ADE80",
                    },
                  ]}
                />
              </Section>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold text-[#ECECEE]">
                <Trans>Calls</Trans>
              </h3>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t`Search calls`}
                aria-label={t`Search calls`}
                className="w-[220px] rounded-lg border border-[#202023] bg-[#131315] px-3 py-1.5 text-[12.5px] text-[#C9C9CE] outline-none placeholder:text-[#5F5B69]"
              />
            </div>
            <div className="mt-2">
              <Table<VoiceCallRow>
                rows={filtered}
                rowKey={(call) => call.id}
                onRowClick={setSelected}
                emptyLabel={t`No calls in this window`}
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
                  { key: "phone", label: t`Phone`, render: (call) => call.callerPhone ?? "—" },
                  {
                    key: "when",
                    label: t`When`,
                    nowrap: true,
                    render: (call) => formatDateTime(call.callStartedAt),
                  },
                  {
                    key: "ai",
                    label: t`AI handled`,
                    render: (call) =>
                      call.aiResolved === null ? (
                        "—"
                      ) : call.aiResolved ? (
                        <StatusPill tone="good">{t`Yes`}</StatusPill>
                      ) : (
                        <StatusPill tone="dim">{t`No`}</StatusPill>
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
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function Tiles({ stats }: { stats: VoiceStats }) {
  const { t } = useLingui();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiTile
        label={t`Total calls`}
        value={formatNumber(stats.totalCalls)}
        delta={stats.deltaPct.totalCalls}
        detail={t`vs previous`}
      />
      <KpiTile
        label={t`AI handled`}
        value={formatNumber(stats.aiHandled)}
        detail={formatPct(stats.aiHandledRatePct)}
        delta={stats.deltaPct.aiHandled}
      />
      <KpiTile
        label={t`Callbacks`}
        value={formatNumber(stats.callbacksRequested)}
        delta={stats.deltaPct.callbacksRequested}
        detail={t`vs previous`}
      />
      <KpiTile
        label={t`Previous period`}
        value={formatNumber(stats.previousPeriod.totalCalls)}
        detail={t`${formatNumber(stats.previousPeriod.aiHandled)} AI handled`}
      />
    </div>
  );
}

function CallDetail({ call, onBack }: { call: VoiceCallRow; onBack: () => void }) {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData<VoiceCallDetail>(
    () => rpc.workspace.voice.call({ callId: call.id }),
    call.id,
  );
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 text-[12.5px] text-[#85858A] hover:text-[#ECECEE]"
      >
        ← <Trans>All calls</Trans>
      </button>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-medium text-[#ECECEE]">
          {callerLabel(call.callerName, t`Unknown caller`)}
        </h3>
        <span className="text-[12.5px] text-[#85858A]">{call.callerPhone ?? ""}</span>
        <span className="text-[12.5px] text-[#6E6975]">{formatDateTime(call.callStartedAt)}</span>
      </div>
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <div className="mt-3 space-y-3">
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
              className="text-[12.5px] text-[#A6A6AD] underline hover:text-[#ECECEE]"
            >
              <Trans>Open recording</Trans>
            </a>
          ) : null}
          {data.transcript ? (
            <Section title={t`Transcript`}>
              <pre className="rk-scroll max-h-[420px] overflow-auto whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-[#A6A6AD]">
                {data.transcript}
              </pre>
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
