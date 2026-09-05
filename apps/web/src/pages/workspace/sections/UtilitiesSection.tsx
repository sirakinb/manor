import { Trans, useLingui } from "@lingui/react/macro";
import type {
  UtilitiesOverview,
  UtilityBillingTarget,
  WaterBillGroup,
  WorkspaceSummary,
} from "@rakazo/contracts";
import { rpc } from "../../../lib/rpc";
import {
  Card,
  Empty,
  ErrorLine,
  formatDate,
  formatMoney,
  formatNumber,
  formatPct,
  KpiTile,
  Loading,
  PageHeader,
  type PillTone,
  StatusPill,
  Table,
  useSectionData,
} from "../bits";

const TARGET_TONE: Record<UtilityBillingTarget["targetStatus"], PillTone> = {
  resolved: "good",
  ambiguous: "warn",
  no_active_lease: "warn",
  unmatched: "bad",
};

const POST_TONE: Record<WaterBillGroup["charges"][number]["postStatus"], PillTone> = {
  pending: "dim",
  posted: "good",
  skipped: "warn",
  error: "bad",
};

export function UtilitiesSection({
  workspace,
  eyebrow,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
}) {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData<UtilitiesOverview>(
    () => rpc.workspace.utilities.overview(),
    "utilities",
  );
  const targetLabel: Record<UtilityBillingTarget["targetStatus"], string> = {
    resolved: t`Pass-through`,
    ambiguous: t`Ambiguous`,
    no_active_lease: t`No active lease`,
    unmatched: t`Unmatched`,
  };
  const postLabel: Record<WaterBillGroup["charges"][number]["postStatus"], string> = {
    pending: t`Pending`,
    posted: t`Posted`,
    skipped: t`Skipped`,
    error: t`Error`,
  };

  const resolved = data?.targets.filter((target) => target.targetStatus === "resolved").length ?? 0;
  const bills = data?.bills ?? [];
  const unmatchedBills = bills.filter((bill) => bill.resolutionStatus === "unmatched").length;
  const ambiguousBills = bills.filter(
    (bill) => bill.resolutionStatus === "ambiguous" || bill.resolutionStatus === "no_active_lease",
  ).length;
  const unparsedBills = bills.filter(
    (bill) => bill.parseStatus === "needs_review" && bill.resolutionStatus === "resolved",
  ).length;
  const attention = unmatchedBills + ambiguousBills + unparsedBills;

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={t`Utilities`}
        subtitle={t`${workspace.name} · water billing, charged to each tenant's ledger`}
      />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile
              label={t`Water-billed properties`}
              value={formatNumber(data.targets.length)}
              caption={t`on the utility account`}
            />
            <KpiTile
              label={t`Billable`}
              value={formatNumber(resolved)}
              caption={t`matched to an active lease`}
            />
            <KpiTile
              label={t`Bills`}
              value={formatNumber(data.bills.length)}
              caption={t`on record`}
            />
            <KpiTile
              label={t`Needs attention`}
              value={formatNumber(attention)}
              caption={t`${formatNumber(unmatchedBills)} unmatched · ${formatNumber(ambiguousBills)} ambiguous · ${formatNumber(unparsedBills)} to parse`}
            />
          </div>

          <Card
            title={t`Bills`}
            subtitle={t`Each bill and the charges prepared for its lease`}
            className="mt-4"
          >
            {data.bills.length === 0 ? (
              <Empty>
                <Trans>No bills yet</Trans>
              </Empty>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {data.bills.map((bill) => (
                  <div
                    key={bill.waterBillId}
                    className="rounded-xl border border-[#202023] bg-[#0F0F11] p-3.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-[#ECECEE]">
                          {bill.serviceAddress ?? t`Unknown address`}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-[#6E6975]">
                          {bill.billingMonth ? formatDate(bill.billingMonth) : "—"}
                          {bill.dueDate ? ` · ${t`Due ${formatDate(bill.dueDate)}`}` : ""}
                          {bill.billingMode ? ` · ${bill.billingMode}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold text-[#ECECEE] tabular-nums">
                          {bill.billAmount === null ? "—" : formatMoney(bill.billAmount)}
                        </span>
                        <StatusPill tone={TARGET_TONE[bill.resolutionStatus]}>
                          {targetLabel[bill.resolutionStatus]}
                        </StatusPill>
                      </div>
                    </div>
                    {bill.memo ? (
                      <p className="mt-2 text-[12px] text-[#85858A]">{bill.memo}</p>
                    ) : null}
                    {bill.charges.length ? (
                      <ul className="mt-3 divide-y divide-[#1C1C1F] border-t border-[#1C1C1F]">
                        {bill.charges.map((charge) => (
                          <li
                            key={charge.leaseId}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[12.5px]"
                          >
                            <span className="min-w-[80px] font-medium text-[#C9C9CE]">
                              {charge.unitNumber
                                ? t`Unit ${charge.unitNumber}`
                                : t`Lease ${charge.leaseId}`}
                            </span>
                            <span className="text-[#85858A] tabular-nums">
                              {formatPct(charge.chargeShare * 100)}
                            </span>
                            <span className="text-[#C9C9CE] tabular-nums">
                              {charge.chargeAmount === null
                                ? "—"
                                : formatMoney(charge.chargeAmount)}
                            </span>
                            <span className="ml-auto flex items-center gap-2">
                              {charge.postedAt ? (
                                <span className="text-[11.5px] text-[#6E6975]">
                                  {formatDate(charge.postedAt)}
                                </span>
                              ) : null}
                              <StatusPill tone={POST_TONE[charge.postStatus]}>
                                {postLabel[charge.postStatus]}
                              </StatusPill>
                            </span>
                            {charge.postError ? (
                              <span className="basis-full text-[11.5px] text-[#F87171]">
                                {charge.postError}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title={t`Water-billed properties`}
            subtitle={t`Each property billed for water, with the lease that carries the charge`}
            className="mt-4"
          >
            <Table<UtilityBillingTarget>
              rows={data.targets}
              rowKey={(target) => target.utilityPropertyId}
              emptyLabel={t`No properties mapped yet`}
              columns={[
                {
                  key: "property",
                  label: t`Property`,
                  width: "34%",
                  render: (target) => (
                    <div>
                      <p className="font-medium text-[#ECECEE]">{target.address}</p>
                      <p className="text-[11.5px] text-[#6E6975]">
                        {target.buildiumAddress ?? t`Not matched to a property`}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "billing",
                  label: t`Billing`,
                  render: (target) => (
                    <StatusPill tone={TARGET_TONE[target.targetStatus]}>
                      {targetLabel[target.targetStatus]}
                    </StatusPill>
                  ),
                },
                {
                  key: "lease",
                  label: t`Lease`,
                  render: (target) =>
                    target.leases.length === 0 ? (
                      "—"
                    ) : (
                      <ul className="space-y-0.5">
                        {target.leases.map((lease) => (
                          <li key={lease.leaseId} className="whitespace-nowrap">
                            <span className="font-medium text-[#ECECEE]">{t`Lease #${lease.leaseId}`}</span>
                            <span className="text-[#6E6975]">
                              {lease.unitNumber ? ` · ${t`Unit ${lease.unitNumber}`}` : ""}
                              {lease.leaseTo ? ` · ${t`to ${formatDate(lease.leaseTo)}`}` : ""}
                              {target.leases.length > 1
                                ? ` · ${formatPct(lease.chargeShare * 100)}`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ),
                },
                {
                  key: "rent",
                  label: t`Rent`,
                  align: "right",
                  render: (target) => {
                    const total = target.leases.reduce((sum, lease) => sum + (lease.rent ?? 0), 0);
                    return target.leases.length ? (
                      <span className="font-semibold text-[#ECECEE]">{formatMoney(total)}</span>
                    ) : (
                      "—"
                    );
                  },
                },
                {
                  key: "mode",
                  label: t`Mode`,
                  render: (target) => <span className="text-[#85858A]">{target.billingMode}</span>,
                },
              ]}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
