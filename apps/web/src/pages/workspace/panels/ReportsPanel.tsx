import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceReport, WorkspaceReportRow } from "@rakazo/contracts";
import { useState } from "react";
import { rpc } from "../../../lib/rpc";
import {
  ErrorLine,
  formatDate,
  formatDateTime,
  humanizeKey,
  isRecord,
  KeyValueTree,
  Loading,
  PanelHeader,
  Section,
  StatusPill,
  Table,
  useSectionData,
} from "../bits";

export function ReportsPanel() {
  const { t } = useLingui();
  const [selected, setSelected] = useState<WorkspaceReportRow | null>(null);
  const { data, error, loading } = useSectionData(() => rpc.workspace.reports.list(), "reports");

  return (
    <div>
      <PanelHeader title={t`Reports`} />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        selected ? (
          <ReportDetail row={selected} onBack={() => setSelected(null)} />
        ) : (
          <Table<WorkspaceReportRow>
            rows={data}
            rowKey={(row) => row.id}
            onRowClick={setSelected}
            emptyLabel={t`No reports yet`}
            columns={[
              {
                key: "title",
                label: t`Title`,
                width: "34%",
                render: (row) => <span className="font-medium text-[#ECECEE]">{row.title}</span>,
              },
              {
                key: "type",
                label: t`Type`,
                nowrap: true,
                render: (row) => humanizeKey(row.reportType),
              },
              {
                key: "range",
                label: t`Range`,
                nowrap: true,
                render: (row) =>
                  row.dateRangeStart || row.dateRangeEnd
                    ? `${formatDate(row.dateRangeStart)} – ${formatDate(row.dateRangeEnd)}`
                    : "—",
              },
              {
                key: "generated",
                label: t`Generated`,
                nowrap: true,
                render: (row) => formatDateTime(row.generatedAt),
              },
              {
                key: "approved",
                label: t`Approved`,
                render: (row) =>
                  row.approvedAt ? (
                    <StatusPill tone="good">{formatDate(row.approvedAt)}</StatusPill>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "sent",
                label: t`Sent`,
                render: (row) =>
                  row.sentAt ? (
                    <StatusPill tone="accent">{formatDate(row.sentAt)}</StatusPill>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        )
      ) : null}
    </div>
  );
}

function ReportDetail({ row, onBack }: { row: WorkspaceReportRow; onBack: () => void }) {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData<WorkspaceReport>(
    () => rpc.workspace.reports.get({ reportId: row.id }),
    row.id,
  );
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 text-[12.5px] text-[#85858A] hover:text-[#ECECEE]"
      >
        ← <Trans>All reports</Trans>
      </button>
      <h3 className="text-[15px] font-medium text-[#ECECEE]">{row.title}</h3>
      <p className="mt-1 text-[12.5px] text-[#6E6975]">
        {humanizeKey(row.reportType)} · {formatDate(row.dateRangeStart)} –{" "}
        {formatDate(row.dateRangeEnd)}
        {row.sentTo ? ` · ${t`Sent to ${row.sentTo}`}` : ""}
      </p>
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <div className="mt-3 space-y-3">
          {data.summary ? (
            <Section title={t`Summary`}>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#C9C9CE]">
                {data.summary}
              </p>
            </Section>
          ) : null}
          <ReportBody report={data.report} />
        </div>
      ) : null}
    </div>
  );
}

/** Known report shapes get sections; anything else becomes a key/value tree. */
function ReportBody({ report }: { report: unknown }) {
  const { t } = useLingui();
  if (!isRecord(report)) {
    return (
      <Section title={t`Report`}>
        <KeyValueTree value={report} />
      </Section>
    );
  }
  // Voice reports: { stats, synthesis, agent_type }.
  if ("synthesis" in report || "stats" in report) {
    const { stats, synthesis, agent_type: agentType, ...rest } = report;
    return (
      <>
        {agentType ? <StatusPill tone="accent">{String(agentType)}</StatusPill> : null}
        {typeof synthesis === "string" ? (
          <Section title={t`Synthesis`}>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#C9C9CE]">
              {synthesis}
            </p>
          </Section>
        ) : synthesis !== undefined ? (
          <Section title={t`Synthesis`}>
            <KeyValueTree value={synthesis} />
          </Section>
        ) : null}
        {stats !== undefined ? (
          <Section title={t`Stats`}>
            <KeyValueTree value={stats} />
          </Section>
        ) : null}
        {Object.keys(rest).length ? (
          <Section title={t`Details`}>
            <KeyValueTree value={rest} />
          </Section>
        ) : null}
      </>
    );
  }
  // Monthly reports: one section per top-level key (metrics, revenue, narrative, ...);
  // the bookkeeping keys become a small tag row instead of sections.
  const META_KEYS = ["format", "agent_type", "audience", "generated_at", "workspace_name"];
  const meta = META_KEYS.filter((key) => typeof report[key] === "string").map(
    (key) => [key, String(report[key])] as const,
  );
  const sections = Object.entries(report)
    .filter(([key]) => !META_KEYS.includes(key))
    .sort(([a], [b]) => sectionRank(a) - sectionRank(b));
  return (
    <>
      {meta.length ? (
        <div className="flex flex-wrap gap-1.5">
          {meta.map(([key, value]) => (
            <span
              key={key}
              className="rounded-full bg-[#1A1A1D] px-2 py-0.5 text-[11px] text-[#A6A6AD]"
              title={humanizeKey(key)}
            >
              {key === "generated_at" ? formatDateTime(value) : value}
            </span>
          ))}
        </div>
      ) : null}
      {sections.map(([key, value]) => (
        <Section key={key} title={humanizeKey(key)}>
          {typeof value === "string" ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#C9C9CE]">
              {value}
            </p>
          ) : (
            <KeyValueTree value={value} />
          )}
        </Section>
      ))}
    </>
  );
}

const SECTION_ORDER = ["narrative", "summary", "metrics", "revenue"];
function sectionRank(key: string): number {
  const index = SECTION_ORDER.indexOf(key);
  return index === -1 ? SECTION_ORDER.length : index;
}
