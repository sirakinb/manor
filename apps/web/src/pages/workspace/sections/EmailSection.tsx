import { Trans, useLingui } from "@lingui/react/macro";
import type {
  EmailCampaignDetail,
  EmailCampaignRow,
  EmailPerformance,
  WorkspaceSummary,
} from "@rakazo/contracts";
import { useMemo, useState } from "react";
import { rpc } from "../../../lib/rpc";
import {
  BarRows,
  Card,
  CLICKABLE_TEXT,
  ColumnBars,
  ErrorLine,
  formatCompact,
  formatDateTime,
  formatNumber,
  formatPct,
  KpiTile,
  Loading,
  PageHeader,
  Section,
  Segmented,
  Table,
  useSectionData,
} from "../bits";

type EmailWindow = EmailPerformance["window"];

/** Rows shown before "Show all", sized to sit level with the links card. */
const RECENT_ROWS = 6;

export function EmailSection({
  workspace,
  eyebrow,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
}) {
  const { t } = useLingui();
  const [window, setWindow] = useState<EmailWindow>("12m");
  const [selected, setSelected] = useState<EmailCampaignRow | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { data, error, loading } = useSectionData(
    () => rpc.workspace.email.performance({ window }),
    window,
  );

  const windowLabel: Record<EmailWindow, string> = {
    "12m": t`Last 12 months`,
    "24m": t`Last 24 months`,
    all: t`All time`,
  };

  // Campaigns per month from the recent list, oldest first.
  const perMonth = useMemo(() => {
    if (!data) return [];
    const byMonth = new Map<string, number>();
    for (const campaign of data.recentCampaigns) {
      if (!campaign.sentAt) continue;
      const key = campaign.sentAt.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, count]) => ({
        label: new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
          month: "short",
          timeZone: "UTC",
        }),
        value: count,
      }));
  }, [data]);

  if (selected) return <CampaignDetail row={selected} onBack={() => setSelected(null)} />;

  const clickToOpen = data && data.opens > 0 ? (data.uniqueClicks / data.opens) * 100 : null;
  const deliveredPct =
    data && data.emailsSent > 0 ? (data.delivered / data.emailsSent) * 100 : null;

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={t`Email performance`}
        subtitle={`${workspace.name} · ${windowLabel[window]}`}
      >
        <Segmented
          label={t`Range`}
          value={window}
          onChange={setWindow}
          options={[
            { key: "12m", label: t`12 months` },
            { key: "24m", label: t`24 months` },
            { key: "all", label: t`All time` },
          ]}
        />
      </PageHeader>
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile
              label={t`Campaigns`}
              value={formatNumber(data.campaignsTotal)}
              caption={windowLabel[window].toLowerCase()}
            />
            <KpiTile
              label={t`Delivered`}
              value={formatCompact(data.delivered)}
              caption={t`${formatPct(deliveredPct, 1)} of ${formatCompact(data.emailsSent)} sent`}
            />
            <KpiTile
              label={t`Open rate`}
              value={formatPct(data.openRatePct, 1)}
              caption={t`${formatCompact(data.opens)} opens`}
            />
            <KpiTile
              label={t`Click rate`}
              value={formatPct(data.clickRatePct, 2)}
              caption={t`${formatPct(clickToOpen, 1)} click-to-open · ${formatCompact(data.uniqueClicks)} clicks`}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card
              title={t`Campaigns per month`}
              subtitle={windowLabel[window]}
              className="lg:col-span-2"
            >
              <ColumnBars bars={perMonth} />
            </Card>
            <Card title={t`Opens by device`}>
              <BarRows
                rows={[
                  { label: t`Computer`, value: data.deviceSplit.computer },
                  { label: t`Mobile`, value: data.deviceSplit.mobile },
                  { label: t`Tablet`, value: data.deviceSplit.tablet },
                ]}
              />
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[#1C1C1F] pt-3 text-[12px]">
                <Stat label={t`Bounce rate`} value={formatPct(data.listHealth.bounceRatePct, 2)} />
                <Stat
                  label={t`Unsubscribe rate`}
                  value={formatPct(data.listHealth.unsubRatePct, 2)}
                />
                <Stat label={t`Hard bounces`} value={formatNumber(data.listHealth.hardBounces)} />
                <Stat
                  label={t`Spam complaints`}
                  value={formatNumber(data.listHealth.spamComplaints)}
                />
              </dl>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card
              title={t`Recent campaigns`}
              subtitle={t`${data.recentCampaigns.length} most recent`}
              className="lg:col-span-2"
            >
              <Table<EmailCampaignRow>
                rows={showAll ? data.recentCampaigns : data.recentCampaigns.slice(0, RECENT_ROWS)}
                rowKey={(row) => row.sourceCampaignId}
                onRowClick={setSelected}
                emptyLabel={t`No campaigns in this range`}
                columns={[
                  {
                    key: "name",
                    label: t`Campaign`,
                    width: "44%",
                    render: (row) => (
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[#ECECEE]">
                          {row.name ?? row.subject ?? "—"}
                        </p>
                        {row.name && row.subject ? (
                          <p className="truncate text-[11.5px] text-[#6E6975]">{row.subject}</p>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    key: "sent",
                    label: t`Sent`,
                    nowrap: true,
                    render: (row) => formatDateTime(row.sentAt),
                  },
                  {
                    key: "count",
                    label: t`Emails`,
                    align: "right",
                    render: (row) => formatNumber(row.emailsSent),
                  },
                  {
                    key: "open",
                    label: t`Open`,
                    align: "right",
                    render: (row) => formatPct(row.openPercent, 1),
                  },
                  {
                    key: "clicks",
                    label: t`Clicks`,
                    align: "right",
                    render: (row) => formatNumber(row.uniqueClicks),
                  },
                ]}
              />
              {data.recentCampaigns.length > RECENT_ROWS ? (
                <button
                  type="button"
                  onClick={() => setShowAll((value) => !value)}
                  className={`mt-3 text-[12.5px] text-[#85858A] ${CLICKABLE_TEXT}`}
                >
                  {showAll
                    ? t`Show fewer`
                    : t`Show all ${formatNumber(data.recentCampaigns.length)}`}
                </button>
              ) : null}
            </Card>
            <Card title={t`Top clicked links`} subtitle={t`What readers acted on`}>
              {data.topLinks.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-[#6E6975]">
                  <Trans>No clicks recorded</Trans>
                </p>
              ) : (
                <ol className="space-y-3">
                  {data.topLinks.map((link, index) => {
                    const max = data.topLinks[0]!.totalClicks || 1;
                    return (
                      <li key={link.url} className="text-[12.5px]">
                        <div className="flex items-baseline justify-between gap-3">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate text-[#C9C9CE] hover:text-[#ECECEE]"
                          >
                            <span className="mr-1.5 text-[#6E6975] tabular-nums">{index + 1}</span>
                            {link.url.replace(/^https?:\/\//, "")}
                          </a>
                          <span className="shrink-0 font-semibold text-[#ECECEE] tabular-nums">
                            {formatNumber(link.totalClicks)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#1C1C1F]">
                            <div
                              className="h-full rounded-full bg-[var(--rk-accent)]"
                              style={{ width: `${(link.totalClicks / max) * 100}%` }}
                            />
                          </div>
                          <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-[#6E6975] tabular-nums">
                            {t`${formatNumber(link.uniqueClickers)} clickers`}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[#85858A]">{label}</dt>
      <dd className="font-medium text-[#C9C9CE] tabular-nums">{value}</dd>
    </div>
  );
}

function CampaignDetail({ row, onBack }: { row: EmailCampaignRow; onBack: () => void }) {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData<EmailCampaignDetail>(
    () => rpc.workspace.email.campaign({ sourceCampaignId: row.sourceCampaignId }),
    row.sourceCampaignId,
  );
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className={`mb-3 text-[12.5px] text-[#85858A] ${CLICKABLE_TEXT}`}
      >
        ← <Trans>All campaigns</Trans>
      </button>
      <PageHeader
        title={row.name ?? row.subject ?? "—"}
        subtitle={[row.subject, formatDateTime(row.sentAt)].filter(Boolean).join(" · ")}
      />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile label={t`Sent`} value={formatNumber(data.emailsSent)} />
            <KpiTile
              label={t`Delivered`}
              value={formatPct(data.deliveredPercent, 1)}
              caption={formatNumber(data.delivered)}
            />
            <KpiTile
              label={t`Opened`}
              value={formatPct(data.openPercent, 1)}
              caption={formatNumber(data.opens)}
            />
            <KpiTile
              label={t`Clicked`}
              value={formatPct(data.clickPercent, 1)}
              caption={formatNumber(data.uniqueClicks)}
            />
          </div>
          <Section title={t`Delivery`}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
              <Stat
                label={t`From`}
                value={
                  data.senderName
                    ? `${data.senderName} <${data.fromEmail ?? ""}>`
                    : (data.fromEmail ?? "—")
                }
              />
              <Stat label={t`Topic`} value={data.topic ?? "—"} />
              <Stat label={t`Unopened`} value={formatNumber(data.unopened)} />
              <Stat label={t`Bounces`} value={formatNumber(data.bounces)} />
              <Stat label={t`Hard bounces`} value={formatNumber(data.hardBounces)} />
              <Stat label={t`Soft bounces`} value={formatNumber(data.softBounces)} />
              <Stat label={t`Spam`} value={formatNumber(data.spam)} />
              <Stat label={t`Forwards`} value={formatNumber(data.forwards)} />
              <Stat label={t`Unsubscribes`} value={formatPct(data.unsubPercent, 2)} />
              <Stat
                label={t`Clicks per open`}
                value={data.clicksPerOpen === null ? "—" : data.clicksPerOpen.toFixed(2)}
              />
            </dl>
          </Section>
          {data.preheader ? (
            <Section title={t`Preheader`}>
              <p className="text-[13px] text-[#C9C9CE]">{data.preheader}</p>
            </Section>
          ) : null}
          {data.links.length ? (
            <Section title={t`Links`}>
              <BarRows
                rows={data.links.map((link) => ({ label: link.url, value: link.uniqueClickers }))}
              />
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
