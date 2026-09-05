import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceReport, WorkspaceReportRow, WorkspaceSummary } from "@rakazo/contracts";
import { rpc } from "../../../lib/rpc";
import {
  Card,
  CLICKABLE_TEXT,
  ErrorLine,
  formatDate,
  formatDateTime,
  humanizeKey,
  isRecord,
  KeyValueTree,
  Loading,
  PageHeader,
  Section,
  StatusPill,
  Table,
  useSectionData,
} from "../bits";
import type { WorkspaceTab } from "../WorkspaceView";

export function ReportsSection({
  workspace,
  eyebrow,
  reportId,
  onOpen,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
  reportId?: string;
  onOpen: (tab: WorkspaceTab, id?: string) => void;
}) {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData(() => rpc.workspace.reports.list(), "reports");

  if (reportId) return <ReportDetail reportId={reportId} onBack={() => onOpen("reports")} />;

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={t`Reports`}
        subtitle={t`${workspace.name} · AI-synthesized reports across channels`}
      />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <Card title={t`Generated reports`} subtitle={t`${data.length} on record`}>
          <Table<WorkspaceReportRow>
            rows={data}
            rowKey={(row) => row.id}
            onRowClick={(row) => onOpen("reports", row.id)}
            emptyLabel={t`No reports yet`}
            columns={[
              {
                key: "title",
                label: t`Title`,
                width: "36%",
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
        </Card>
      ) : null}
    </div>
  );
}

function ReportDetail({ reportId, onBack }: { reportId: string; onBack: () => void }) {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData<WorkspaceReport>(
    () => rpc.workspace.reports.get({ reportId }),
    reportId,
  );
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className={`mb-3 text-[12.5px] text-[#85858A] ${CLICKABLE_TEXT}`}
      >
        ← <Trans>All reports</Trans>
      </button>
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <PageHeader
            title={data.title}
            subtitle={`${humanizeKey(data.reportType)} · ${formatDate(data.dateRangeStart)} – ${formatDate(data.dateRangeEnd)}${
              data.sentTo ? ` · ${t`Sent to ${data.sentTo}`}` : ""
            }`}
          />
          <div className="space-y-3">
            {data.summary ? (
              <Section title={t`Summary`}>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#C9C9CE]">
                  {data.summary}
                </p>
              </Section>
            ) : null}
            <ReportBody report={data.report} />
          </div>
        </>
      ) : null}
    </div>
  );
}

const META_KEYS = ["format", "agent_type", "audience", "generated_at", "workspace_name"];
const SECTION_ORDER = ["narrative", "summary", "metrics", "revenue"];
function sectionRank(key: string): number {
  const index = SECTION_ORDER.indexOf(key);
  return index === -1 ? SECTION_ORDER.length : index;
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
  // On-demand voice reports: { stats, synthesis, agent_type }.
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
  // Monthly reports: one section per top-level key (narrative, metrics, revenue, ...);
  // the bookkeeping keys become a small tag row instead of sections.
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
