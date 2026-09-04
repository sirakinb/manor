import { Trans, useLingui } from "@lingui/react/macro";
import type { AvailableRentals, LeasingSnapshot, RentalListing } from "@rakazo/contracts";
import { useState } from "react";
import { rpc } from "../../../lib/rpc";
import {
  BarRows,
  ErrorLine,
  formatDate,
  formatMoney,
  formatNumber,
  formatPct,
  humanizeKey,
  KpiTile,
  Loading,
  PanelHeader,
  Section,
  Segmented,
  StatusPill,
  Table,
  useSectionData,
} from "../bits";

type LeasingTab = "overview" | "rentals";
type ListingFilter = AvailableRentals["filter"];

export function LeasingPanel() {
  const { t } = useLingui();
  const [tab, setTab] = useState<LeasingTab>("overview");
  return (
    <div>
      <PanelHeader title={t`Leasing`}>
        <Segmented
          label={t`View`}
          value={tab}
          onChange={setTab}
          options={[
            { key: "overview", label: t`Overview` },
            { key: "rentals", label: t`Available rentals` },
          ]}
        />
      </PanelHeader>
      {tab === "overview" ? <Overview /> : <Rentals />}
    </div>
  );
}

function Overview() {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData<LeasingSnapshot>(
    () => rpc.workspace.leasing.snapshot(),
    "leasing",
  );
  if (error) return <ErrorLine message={error} />;
  if (loading || !data) return <Loading />;
  const { applications, leases } = data;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiTile
          label={t`Active leases`}
          value={formatNumber(leases.active)}
          detail={leases.holdover ? t`${formatNumber(leases.holdover)} holdover` : undefined}
        />
        <KpiTile
          label={t`Rent roll`}
          value={formatMoney(leases.monthlyRentRoll)}
          detail={t`per month`}
        />
        <KpiTile
          label={t`Avg rent`}
          value={leases.avgRent === null ? "—" : formatMoney(leases.avgRent)}
        />
        <KpiTile
          label={t`Applications 30d`}
          value={formatNumber(applications.last30d)}
          delta={applications.deltaPctVsPrior30d}
          detail={t`vs prior 30d`}
        />
        <KpiTile label={t`Approval rate`} value={formatPct(applications.approvalRatePct)} />
        <KpiTile label={t`Expiring 90d`} value={formatNumber(leases.expiringNext90d)} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Section title={t`Application funnel`}>
          <BarRows
            rows={applications.funnel.map((step) => ({
              label: humanizeKey(step.status),
              value: step.count,
            }))}
          />
        </Section>
        <Section title={t`Monthly submissions`}>
          <BarRows
            rows={applications.monthlySubmissions12m.map((month) => ({
              label: month.month,
              value: month.applications,
            }))}
          />
        </Section>
      </div>
      <h3 className="mt-4 mb-2 text-[13px] font-semibold text-[#ECECEE]">
        <Trans>Upcoming expirations</Trans>
      </h3>
      <Table
        rows={leases.upcomingExpirations}
        rowKey={(row) => String(row.leaseId)}
        emptyLabel={t`No leases expire soon`}
        columns={[
          {
            key: "unit",
            label: t`Unit`,
            render: (row) => (
              <span className="font-medium text-[#ECECEE]">{row.unitNumber ?? row.leaseId}</span>
            ),
          },
          { key: "to", label: t`Ends`, nowrap: true, render: (row) => formatDate(row.leaseTo) },
          {
            key: "rent",
            label: t`Rent`,
            align: "right",
            render: (row) => (row.rent === null ? "—" : formatMoney(row.rent)),
          },
        ]}
      />
    </>
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
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t`Listing type`}
          value={filter}
          onChange={setFilter}
          options={[
            { key: "all", label: t`All` },
            { key: "section8", label: t`Section 8` },
            { key: "market", label: t`Market` },
          ]}
        />
        {data ? (
          <span className="text-[12.5px] text-[#85858A] tabular-nums">
            {t`${formatNumber(data.count)} available`}
            {data.avgRent !== null ? ` · ${t`avg ${formatMoney(data.avgRent)}`}` : ""}
          </span>
        ) : null}
      </div>
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
              label: t`Address`,
              width: "40%",
              render: (row) => (
                <div>
                  <p className="font-medium text-[#ECECEE]">
                    {[row.addressLine, row.unitNumber ? `#${row.unitNumber}` : null]
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                  <p className="text-[11.5px] text-[#6E6975]">
                    {[row.city, row.state, row.postalCode].filter(Boolean).join(", ")}
                  </p>
                </div>
              ),
            },
            {
              key: "beds",
              label: t`Beds / baths`,
              render: (row) => `${row.bedrooms ?? "—"} / ${row.bathrooms ?? "—"}`,
            },
            {
              key: "rent",
              label: t`Rent`,
              align: "right",
              render: (row) => (row.rent === null ? "—" : formatMoney(row.rent)),
            },
            {
              key: "available",
              label: t`Available`,
              nowrap: true,
              render: (row) => formatDate(row.availableDate),
            },
            {
              key: "s8",
              label: t`Section 8`,
              render: (row) =>
                row.isSection8 ? <StatusPill tone="accent">{t`Yes`}</StatusPill> : "—",
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
    </>
  );
}
