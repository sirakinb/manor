import { Trans, useLingui } from "@lingui/react/macro";
import type { UtilitiesOverview, UtilityBillingTarget, WaterBillGroup } from "@rakazo/contracts";
import { rpc } from "../../../lib/rpc";
import {
  Empty,
  ErrorLine,
  formatDate,
  formatMoney,
  formatPct,
  Loading,
  PanelHeader,
  type PillTone,
  StatusPill,
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

export function UtilitiesPanel() {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData<UtilitiesOverview>(
    () => rpc.workspace.utilities.overview(),
    "utilities",
  );
  const targetLabel: Record<UtilityBillingTarget["targetStatus"], string> = {
    resolved: t`Resolved`,
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

  return (
    <div>
      <PanelHeader title={t`Utilities`} />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <h3 className="mb-2 text-[13px] font-semibold text-[#ECECEE]">
            <Trans>Bills</Trans>
          </h3>
          {data.bills.length === 0 ? (
            <Empty>
              <Trans>No bills yet</Trans>
            </Empty>
          ) : (
            <div className="space-y-3">
              {data.bills.map((bill) => (
                <div
                  key={bill.waterBillId}
                  className="rounded-xl border border-[#202023] bg-[#131315] p-3.5"
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
                            {charge.chargeAmount === null ? "—" : formatMoney(charge.chargeAmount)}
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

          <h3 className="mt-5 mb-2 text-[13px] font-semibold text-[#ECECEE]">
            <Trans>Billing targets</Trans>
          </h3>
          {data.targets.length === 0 ? (
            <Empty>
              <Trans>No properties mapped yet</Trans>
            </Empty>
          ) : (
            <ul className="divide-y divide-[#1C1C1F] rounded-xl border border-[#202023]">
              {data.targets.map((target) => (
                <li key={target.utilityPropertyId} className="px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#ECECEE]">
                        {target.address}
                      </p>
                      <p className="text-[11.5px] text-[#6E6975]">
                        {target.buildiumAddress ?? t`Not matched to a property`}
                        {` · ${target.billingMode}`}
                      </p>
                    </div>
                    <StatusPill tone={TARGET_TONE[target.targetStatus]}>
                      {targetLabel[target.targetStatus]}
                    </StatusPill>
                  </div>
                  {target.leases.length ? (
                    <p className="mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-[#85858A] tabular-nums">
                      {target.leases.map((lease) => (
                        <span key={lease.leaseId}>
                          {lease.unitNumber
                            ? t`Unit ${lease.unitNumber}`
                            : t`Lease ${lease.leaseId}`}{" "}
                          · {formatPct(lease.chargeShare * 100)}
                          {lease.rent !== null ? ` · ${formatMoney(lease.rent)}` : ""}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
