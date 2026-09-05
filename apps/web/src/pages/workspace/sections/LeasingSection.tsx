import { Trans, useLingui } from "@lingui/react/macro";
import type {
  AvailableRentals,
  LeasingSnapshot,
  RentalListing,
  WorkspaceSummary,
} from "@rakazo/contracts";
import { useState } from "react";
import { rpc } from "../../../lib/rpc";
import {
  BarRows,
  Card,
  ColumnBars,
  ErrorLine,
  formatDate,
  formatMoney,
  formatMoneyAuto,
  formatNumber,
  formatPct,
  humanizeKey,
  KpiTile,
  Loading,
  PageHeader,
  Segmented,
  StatusPill,
  Table,
  useSectionData,
} from "../bits";

type ListingFilter = AvailableRentals["filter"];

export function LeasingSection({
  workspace,
  eyebrow,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
}) {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData<LeasingSnapshot>(
    () => rpc.workspace.leasing.snapshot(),
    "leasing",
  );

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={t`Leasing`}
        subtitle={t`${workspace.name} · applications, rent roll & renewals`}
      />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile
              label={t`Applications`}
              value={formatNumber(data.applications.last30d)}
              delta={data.applications.deltaPctVsPrior30d}
              caption={t`last 30 days vs prior 30`}
            />
            <KpiTile
              label={t`Approval rate`}
              value={formatPct(data.applications.approvalRatePct)}
              caption={t`of decided applications`}
            />
            <KpiTile
              label={t`Active leases`}
              value={formatNumber(data.leases.active)}
              caption={
                data.leases.avgRent === null
                  ? data.leases.holdover
                    ? t`${formatNumber(data.leases.holdover)} holdover`
                    : undefined
                  : t`avg ${formatMoneyAuto(data.leases.avgRent)}/mo`
              }
            />
            <KpiTile
              label={t`Scheduled rent`}
              value={formatMoneyAuto(data.leases.monthlyRentRoll)}
              caption={t`per month · ${formatNumber(data.leases.expiringNext90d)} expiring in 90d`}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card title={t`Application funnel`} subtitle={t`All applications on record`}>
              <BarRows
                rows={data.applications.funnel.map((step) => ({
                  label: humanizeKey(step.status),
                  value: step.count,
                }))}
              />
            </Card>
            <Card
              title={t`Monthly submissions`}
              subtitle={t`Last 12 months`}
              className="lg:col-span-2"
            >
              <ColumnBars
                bars={data.applications.monthlySubmissions12m.map((month) => ({
                  label: month.month.slice(2),
                  value: month.applications,
                }))}
              />
            </Card>
          </div>
          <div className="mt-4">
            <Rentals />
          </div>
          <Card
            title={t`Upcoming expirations`}
            subtitle={t`${formatNumber(data.leases.expiringNext90d)} leases end in the next 90 days`}
            className="mt-4"
          >
            <Table
              rows={data.leases.upcomingExpirations}
              rowKey={(row) => String(row.leaseId)}
              emptyLabel={t`No leases expire soon`}
              columns={[
                {
                  key: "property",
                  label: t`Property`,
                  width: "50%",
                  render: (row) => (
                    <div>
                      <p className="font-medium text-[#ECECEE]">
                        {row.propertyAddress ?? t`Lease ${row.leaseId}`}
                      </p>
                      {row.unitNumber ? (
                        <p className="text-[11.5px] text-[#6E6975]">{t`Unit ${row.unitNumber}`}</p>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: "to",
                  label: t`Ends`,
                  nowrap: true,
                  render: (row) => formatDate(row.leaseTo),
                },
                {
                  key: "rent",
                  label: t`Rent`,
                  align: "right",
                  render: (row) => (
                    <span className="font-semibold text-[#ECECEE]">
                      {row.rent === null ? "—" : formatMoney(row.rent)}
                    </span>
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

function Rentals() {
  const { t } = useLingui();
  const [filter, setFilter] = useState<ListingFilter>("all");
  const { data, error, loading } = useSectionData<AvailableRentals>(
    () => rpc.workspace.leasing.rentals({ filter }),
    filter,
  );
  return (
    <Card
      title={t`Available rentals`}
      subtitle={
        data
          ? t`${formatNumber(data.count)} active · ${formatNumber(data.section8Count)} Section 8 · ${formatNumber(data.count - data.section8Count)} market${
              data.avgRent !== null ? ` · ${t`avg ${formatMoneyAuto(data.avgRent)}`}` : ""
            }`
          : undefined
      }
      right={
        <Segmented
          label={t`Listing type`}
          value={filter}
          onChange={setFilter}
          options={[
            { key: "all", label: t`All` },
            { key: "section8", label: t`Section 8` },
            { key: "market", label: t`Market rent` },
          ]}
        />
      }
    >
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <Table<RentalListing>
          rows={data.listings}
          rowKey={(row) => String(row.unitId)}
          emptyLabel={t`No rentals match`}
          columns={[
            {
              key: "address",
              label: t`Property`,
              width: "40%",
              render: (row) => (
                <div>
                  <p className="font-medium text-[#ECECEE]">{row.addressLine ?? "—"}</p>
                  <p className="text-[11.5px] text-[#6E6975]">
                    {[
                      row.unitNumber ? t`Unit ${row.unitNumber}` : null,
                      [row.city, row.postalCode].filter(Boolean).join(" "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              ),
            },
            {
              key: "beds",
              label: t`Bd/ba`,
              nowrap: true,
              render: (row) => `${row.bedrooms ?? "—"}bd / ${row.bathrooms ?? "—"}ba`,
            },
            {
              key: "rent",
              label: t`Rent`,
              align: "right",
              render: (row) => (
                <span className="font-semibold text-[#ECECEE]">
                  {row.rent === null ? "—" : formatMoney(row.rent)}
                </span>
              ),
            },
            {
              key: "available",
              label: t`Available`,
              nowrap: true,
              render: (row) => formatDate(row.availableDate),
            },
            {
              key: "type",
              label: t`Type`,
              render: (row) =>
                row.isSection8 ? (
                  <StatusPill tone="good">{t`Section 8`}</StatusPill>
                ) : (
                  <span className="text-[#85858A]">{t`Market`}</span>
                ),
            },
            {
              key: "apply",
              label: "",
              render: (row) =>
                row.applicationUrl ? (
                  <a
                    href={row.applicationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#A6A6AD] underline hover:text-[#ECECEE]"
                  >
                    <Trans>Apply</Trans>
                  </a>
                ) : null,
            },
          ]}
        />
      ) : null}
    </Card>
  );
}
