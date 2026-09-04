import { Trans, useLingui } from "@lingui/react/macro";
import type { EmailCampaignDetail, EmailCampaignRow, EmailPerformance } from "@rakazo/contracts";
import { useState } from "react";
import { accentColor } from "../../../lib/brand";
import { rpc } from "../../../lib/rpc";
import {
  BarRows,
  ErrorLine,
  formatDateTime,
  formatNumber,
  formatPct,
  KpiTile,
  Loading,
  PanelHeader,
  Section,
  Segmented,
  Table,
  useSectionData,
} from "../bits";

type EmailWindow = EmailPerformance["window"];

export function EmailPanel() {
  const { t } = useLingui();
  const [window, setWindow] = useState<EmailWindow>("12m");
  const [selected, setSelected] = useState<EmailCampaignRow | null>(null);
  const { data, error, loading } = useSectionData(
    () => rpc.workspace.email.performance({ window }),
    window,
  );

  return (
    <div>
      <PanelHeader title={t`Email`}>
        <Segmented
          label={t`Window`}
          value={window}
          onChange={(next) => {
            setWindow(next);
            setSelected(null);
          }}
          options={[
            { key: "12m", label: t`12 months` },
            { key: "24m", label: t`24 months` },
            { key: "all", label: t`All time` },
          ]}
        />
      </PanelHeader>
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        selected ? (
          <CampaignDetail row={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <KpiTile label={t`Campaigns`} value={formatNumber(data.campaignsTotal)} />
              <KpiTile label={t`Sent`} value={formatNumber(data.emailsSent)} />
              <KpiTile label={t`Delivered`} value={formatNumber(data.delivered)} />
              <KpiTile label={t`Open rate`} value={formatPct(data.openRatePct, 1)} />
              <KpiTile label={t`Click rate`} value={formatPct(data.clickRatePct, 1)} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Section title={t`Opens by device`}>
                <BarRows
                  rows={[
                    { label: t`Computer`, value: data.deviceSplit.computer },
                    { label: t`Mobile`, value: data.deviceSplit.mobile },
                    { label: t`Tablet`, value: data.deviceSplit.tablet },
                  ]}
                />
              </Section>
              <Section title={t`List health`}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                  <Stat label={t`Hard bounces`} value={formatNumber(data.listHealth.hardBounces)} />
                  <Stat label={t`Soft bounces`} value={formatNumber(data.listHealth.softBounces)} />
                  <Stat
                    label={t`Spam complaints`}
                    value={formatNumber(data.listHealth.spamComplaints)}
                  />
                  <Stat label={t`Forwards`} value={formatNumber(data.listHealth.forwards)} />
                  <Stat
                    label={t`Bounce rate`}
                    value={formatPct(data.listHealth.bounceRatePct, 2)}
                  />
                  <Stat
                    label={t`Unsubscribe rate`}
                    value={formatPct(data.listHealth.unsubRatePct, 2)}
                  />
                </dl>
              </Section>
            </div>
            <h3 className="mt-4 mb-2 text-[13px] font-semibold text-[#ECECEE]">
              <Trans>Recent campaigns</Trans>
            </h3>
            <Table<EmailCampaignRow>
              rows={data.recentCampaigns}
              rowKey={(row) => row.sourceCampaignId}
              onRowClick={setSelected}
              emptyLabel={t`No campaigns in this window`}
              columns={[
                {
                  key: "name",
                  label: t`Campaign`,
                  width: "36%",
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
                {
                  key: "unsub",
                  label: t`Unsubs`,
                  align: "right",
                  render: (row) => formatNumber(row.unsubscribes),
                },
              ]}
            />
            {data.topLinks.length ? (
              <div className="mt-4">
                <Section title={t`Top links`}>
                  <ol className="space-y-2">
                    {data.topLinks.map((link) => (
                      <li key={link.url} className="flex items-center gap-3 text-[12.5px]">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate text-[#C9C9CE] hover:text-[#ECECEE]"
                        >
                          {link.url}
                        </a>
                        <span className="shrink-0 text-[#85858A] tabular-nums">
                          {t`${formatNumber(link.uniqueClickers)} clickers`}
                        </span>
                        <span className="shrink-0 text-[#6E6975] tabular-nums">
                          {t`${formatNumber(link.campaigns)} campaigns`}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Section>
              </div>
            ) : null}
          </>
        )
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
        className="mb-3 text-[12.5px] text-[#85858A] hover:text-[#ECECEE]"
      >
        ← <Trans>All campaigns</Trans>
      </button>
      <h3 className="text-[15px] font-medium text-[#ECECEE]">{row.name ?? row.subject ?? "—"}</h3>
      <p className="mt-1 text-[12.5px] text-[#6E6975]">
        {row.subject ?? ""} · {formatDateTime(row.sentAt)}
      </p>
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile label={t`Sent`} value={formatNumber(data.emailsSent)} />
            <KpiTile label={t`Delivered`} value={formatPct(data.deliveredPercent, 1)} />
            <KpiTile
              label={t`Opened`}
              value={formatPct(data.openPercent, 1)}
              detail={formatNumber(data.opens)}
            />
            <KpiTile
              label={t`Clicked`}
              value={formatPct(data.clickPercent, 1)}
              detail={formatNumber(data.uniqueClicks)}
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
                color={accentColor}
                rows={data.links.map((link) => ({ label: link.url, value: link.uniqueClickers }))}
              />
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
