import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ChargePostBatch,
  UtilitiesOverview,
  UtilityBillingTarget,
  WaterBillGroup,
  WorkspaceSummary,
} from "@rakazo/contracts";
import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { BuiButton } from "../../../components/beautiful-ui/primitives";
import { rpc } from "../../../lib/rpc";
import {
  Card,
  CLICKABLE_TEXT,
  ConfirmCard,
  Empty,
  ErrorLine,
  errorMessage,
  formatDate,
  formatMoney,
  formatNumber,
  formatPct,
  INPUT,
  KpiTile,
  Loading,
  PageHeader,
  type PillTone,
  Segmented,
  StatusPill,
  Table,
  useSectionData,
} from "../bits";

type Charge = WaterBillGroup["charges"][number];

const TARGET_TONE: Record<UtilityBillingTarget["targetStatus"], PillTone> = {
  resolved: "good",
  ambiguous: "warn",
  no_active_lease: "warn",
  unmatched: "bad",
};

const POST_TONE: Record<Charge["postStatus"], PillTone> = {
  pending: "dim",
  posted: "good",
  skipped: "warn",
  error: "bad",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Refusals about missing configuration point at the settings screen. */
function needsSettings(message: string): boolean {
  return /credential|account/i.test(message);
}

export function UtilitiesSection({
  workspace,
  eyebrow,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
}) {
  const { t } = useLingui();
  const { data, error, loading, setData, reload } = useSectionData<UtilitiesOverview>(
    () => rpc.workspace.utilities.overview(),
    "utilities",
  );
  const [postAllOpen, setPostAllOpen] = useState(false);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllError, setPostAllError] = useState<string | null>(null);
  const [batch, setBatch] = useState<ChargePostBatch | null>(null);
  const [view, setView] = useState<"bills" | "properties">("bills");
  const [filter, setFilter] = useState<"all" | "pending" | "attention" | "posted">("all");
  const [search, setSearch] = useState("");

  const targetLabel: Record<UtilityBillingTarget["targetStatus"], string> = {
    resolved: t`Pass-through`,
    ambiguous: t`Ambiguous`,
    no_active_lease: t`No active lease`,
    unmatched: t`Unmatched`,
  };

  const resolved = data?.targets.filter((target) => target.targetStatus === "resolved").length ?? 0;
  const bills = data?.bills ?? [];
  const attention = bills.filter(
    (bill) =>
      bill.resolutionStatus !== "resolved" ||
      bill.parseStatus === "needs_review" ||
      bill.charges.some((charge) => charge.postStatus === "error"),
  ).length;
  const pendingCharges = bills
    .filter((bill) => bill.resolutionStatus === "resolved")
    .flatMap((bill) => bill.charges.filter((charge) => charge.postStatus === "pending"));
  const pendingTotal = pendingCharges.reduce((sum, charge) => sum + (charge.chargeAmount ?? 0), 0);
  const query = search.trim().toLocaleLowerCase();
  const visibleBills = bills.filter((bill) => {
    if (
      query &&
      !`${bill.serviceAddress ?? ""} ${bill.billingMonth ?? ""}`.toLocaleLowerCase().includes(query)
    )
      return false;
    if (filter === "pending") return bill.charges.some((charge) => charge.postStatus === "pending");
    if (filter === "attention")
      return (
        bill.resolutionStatus !== "resolved" ||
        bill.parseStatus === "needs_review" ||
        bill.charges.some((charge) => charge.postStatus === "error")
      );
    if (filter === "posted")
      return (
        bill.charges.length > 0 && bill.charges.every((charge) => charge.postStatus === "posted")
      );
    return true;
  });

  async function postAll() {
    setPostAllBusy(true);
    setPostAllError(null);
    try {
      const result = await rpc.workspace.utilities.postAllPending({});
      setBatch(result);
      setPostAllOpen(false);
      reload();
    } catch (cause) {
      setPostAllError(errorMessage(cause, t`Could not post`));
    } finally {
      setPostAllBusy(false);
    }
  }

  return (
    <div className="ws-refined">
      <PageHeader eyebrow={eyebrow} title={t`Utilities`} subtitle={workspace.name} />
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
              caption={attention ? t`Review billing matches and charges` : t`No billing issues`}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t`Utilities view`}
              value={view}
              onChange={setView}
              options={[
                { key: "bills", label: t`Bills` },
                { key: "properties", label: t`Properties` },
              ]}
            />
            <label className="relative w-full sm:w-64">
              <Search
                size={14}
                className="pointer-events-none absolute top-2.5 left-3 text-[#A6A6AD]"
              />
              <input
                className={`${INPUT} pl-9`}
                aria-label={t`Search properties or bills`}
                placeholder={t`Search address…`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {view === "bills" ? (
            <Card
              title={t`Bills`}
              subtitle={t`${formatNumber(pendingCharges.length)} pending charges · ${formatMoney(pendingTotal)}`}
              className="mt-4"
              right={
                pendingCharges.length > 0 ? (
                  <BuiButton
                    tone="accent"
                    onClick={() => setPostAllOpen(true)}
                    disabled={postAllBusy}
                  >
                    {t`Post all pending (${formatNumber(pendingCharges.length)})`}
                  </BuiButton>
                ) : null
              }
            >
              <div className="mb-3 overflow-x-auto">
                <Segmented
                  label={t`Bill status`}
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { key: "all", label: t`All` },
                    { key: "pending", label: t`Pending` },
                    { key: "attention", label: t`Needs attention` },
                    { key: "posted", label: t`Posted` },
                  ]}
                />
              </div>
              {postAllOpen ? (
                <div className="mb-4">
                  <ConfirmCard
                    title={t`Post ${formatNumber(pendingCharges.length)} charges to Buildium?`}
                    lines={[
                      { label: t`Charges`, value: formatNumber(pendingCharges.length) },
                      { label: t`Total`, value: formatMoney(pendingTotal) },
                      { label: t`Date`, value: formatDate(today()) },
                    ]}
                    confirmLabel={t`Post all`}
                    cancelLabel={t`Cancel`}
                    busy={postAllBusy}
                    error={postAllError}
                    onConfirm={() => void postAll()}
                    onCancel={() => setPostAllOpen(false)}
                  />
                  {postAllError && needsSettings(postAllError) ? <SettingsLink /> : null}
                </div>
              ) : null}
              {batch ? <BatchSummary batch={batch} onDismiss={() => setBatch(null)} /> : null}
              {visibleBills.length === 0 ? (
                <Empty>
                  {bills.length === 0 ? t`No bills yet` : t`No bills match these filters`}
                </Empty>
              ) : (
                <div className="divide-y divide-[#282D2F]">
                  {visibleBills.map((bill) => (
                    <BillCard
                      key={bill.waterBillId}
                      bill={bill}
                      statusLabel={targetLabel[bill.resolutionStatus]}
                      onChanged={setData}
                      onPosted={reload}
                    />
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <Card
              title={t`Water-billed properties`}
              subtitle={t`Each property billed for water, with the lease that carries the charge`}
              className="mt-4"
            >
              <Table<UtilityBillingTarget>
                rows={data.targets.filter(
                  (target) =>
                    !query ||
                    `${target.address} ${target.buildiumAddress ?? ""}`
                      .toLocaleLowerCase()
                      .includes(query),
                )}
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
                        <p className="text-[11.5px] text-[var(--ws-muted,#6E6975)]">
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
                              <span className="text-[var(--ws-muted,#6E6975)]">
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
                      const total = target.leases.reduce(
                        (sum, lease) => sum + (lease.rent ?? 0),
                        0,
                      );
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
                    render: (target) => (
                      <span className="text-[#85858A]">{target.billingMode}</span>
                    ),
                  },
                ]}
              />
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

function SettingsLink() {
  return (
    <a
      href="/app/workspace/settings"
      className={`mt-2 inline-block text-[12.5px] text-[#A6A6AD] underline ${CLICKABLE_TEXT}`}
    >
      <Trans>Open settings</Trans>
    </a>
  );
}

function BatchSummary({ batch, onDismiss }: { batch: ChargePostBatch; onDismiss: () => void }) {
  const { t } = useLingui();
  const failures = batch.results.filter((result) => result.status === "error");
  return (
    <div className="mb-4 rounded-xl border border-[#202023] bg-[#0F0F11] p-3.5 text-[12.5px]">
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-wrap gap-2">
          <StatusPill
            tone={batch.posted > 0 ? "good" : "dim"}
          >{t`${formatNumber(batch.posted)} posted`}</StatusPill>
          <StatusPill
            tone={batch.failed > 0 ? "bad" : "dim"}
          >{t`${formatNumber(batch.failed)} failed`}</StatusPill>
        </span>
        <button type="button" onClick={onDismiss} className={`text-[#85858A] ${CLICKABLE_TEXT}`}>
          <Trans>Dismiss</Trans>
        </button>
      </div>
      {failures.length ? (
        <ul className="mt-2 space-y-1 text-[#F87171]">
          {failures.map((result) => (
            <li key={`${result.waterBillId}:${result.leaseId}`}>
              {t`Lease #${result.leaseId}`} · {result.error ?? t`failed`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BillCard({
  bill,
  statusLabel,
  onChanged,
  onPosted,
}: {
  bill: WaterBillGroup;
  statusLabel: string;
  onChanged: (next: UtilitiesOverview) => void;
  onPosted: () => void;
}) {
  const { t } = useLingui();
  return (
    <details className="group py-1" data-testid="workspace-bill">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-lg px-1 py-3 outline-none transition-colors hover:bg-[#1B2022] focus-visible:ring-2 focus-visible:ring-[#83BFB1]">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-[#ECECEE]">
            {bill.serviceAddress ?? t`Unknown address`}
          </p>
          <p className="mt-0.5 text-[11.5px] text-[var(--ws-muted,#6E6975)]">
            {bill.billingMonth ? formatDate(bill.billingMonth) : "—"}
            {bill.dueDate ? ` · ${t`Due ${formatDate(bill.dueDate)}`}` : ""}
            {bill.billingMode ? ` · ${bill.billingMode}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-[#ECECEE] tabular-nums">
            {bill.billAmount === null ? "—" : formatMoney(bill.billAmount)}
          </span>
          <StatusPill tone={TARGET_TONE[bill.resolutionStatus]}>{statusLabel}</StatusPill>
          <ChevronDown size={15} className="ws-expand text-[#A6A6AD] transition-transform" />
        </div>
      </summary>
      {bill.memo ? <p className="mt-2 text-[12px] text-[#85858A]">{bill.memo}</p> : null}
      {bill.charges.length ? (
        <ul className="mt-3 divide-y divide-[#1C1C1F] border-t border-[#1C1C1F]">
          {bill.charges.map((charge) => (
            <ChargeRow
              key={charge.leaseId}
              bill={bill}
              charge={charge}
              onChanged={onChanged}
              onPosted={onPosted}
            />
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function ChargeRow({
  bill,
  charge,
  onChanged,
  onPosted,
}: {
  bill: WaterBillGroup;
  charge: Charge;
  onChanged: (next: UtilitiesOverview) => void;
  onPosted: () => void;
}) {
  const { t } = useLingui();
  const postLabel: Record<Charge["postStatus"], string> = {
    pending: t`Pending`,
    posted: t`Posted`,
    skipped: t`Skipped`,
    error: t`Error`,
  };
  const startingAmount = charge.postedAmount ?? charge.chargeAmount;
  const startingMemo = charge.postedMemo ?? bill.memo ?? "";
  const [amount, setAmount] = useState(startingAmount === null ? "" : String(startingAmount));
  const [memo, setMemo] = useState(startingMemo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const unitLabel = charge.unitNumber ? t`Unit ${charge.unitNumber}` : t`Lease ${charge.leaseId}`;
  const key = { waterBillId: bill.waterBillId, leaseId: charge.leaseId };
  const editable = charge.postStatus === "pending" || charge.postStatus === "error";

  async function run(action: () => Promise<UtilitiesOverview>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
    } catch (cause) {
      setError(errorMessage(cause, t`Could not save`));
    } finally {
      setBusy(false);
    }
  }

  function saveIfChanged() {
    const nextAmount = amount === "" ? null : Number(amount);
    const amountChanged =
      nextAmount !== null && Number.isFinite(nextAmount) && nextAmount !== startingAmount;
    const memoChanged = memo.trim() !== startingMemo;
    if (!amountChanged && !memoChanged) return;
    void run(() =>
      rpc.workspace.utilities.charge.save({
        ...key,
        ...(amountChanged ? { amount: nextAmount } : {}),
        ...(memoChanged ? { memo: memo.trim() } : {}),
      }),
    );
  }

  async function post() {
    setBusy(true);
    setError(null);
    try {
      const parsed = amount === "" ? undefined : Number(amount);
      const result = await rpc.workspace.utilities.charge.post({
        ...key,
        ...(parsed !== undefined && Number.isFinite(parsed) ? { amount: parsed } : {}),
        memo: memo.trim() || undefined,
        chargeDate: today(),
      });
      if (result.status === "error") setError(result.error ?? t`Could not post`);
      setConfirming(false);
      onPosted();
    } catch (cause) {
      setError(errorMessage(cause, t`Could not post`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-2.5 text-[12.5px]" data-charge-status={charge.postStatus}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-[80px] font-medium text-[#C9C9CE]">{unitLabel}</span>
        <span className="text-[#85858A] tabular-nums">{formatPct(charge.chargeShare * 100)}</span>
        {editable ? (
          <>
            <input
              aria-label={t`Amount`}
              className={`${INPUT} w-[110px]`}
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
              onBlur={saveIfChanged}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
            />
            <input
              aria-label={t`Memo`}
              className={`${INPUT} min-w-[160px] flex-1`}
              maxLength={200}
              value={memo}
              disabled={busy}
              onChange={(event) => setMemo(event.target.value)}
              onBlur={saveIfChanged}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
            />
          </>
        ) : (
          <>
            <span className="text-[#C9C9CE] tabular-nums">
              {startingAmount === null ? "—" : formatMoney(startingAmount)}
            </span>
            {charge.postedMemo ? (
              <span className="truncate text-[#85858A]">{charge.postedMemo}</span>
            ) : null}
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          {charge.postStatus === "posted" ? (
            <>
              <span className="text-[11.5px] text-[var(--ws-muted,#6E6975)] tabular-nums">
                {charge.buildiumChargeId !== null ? `#${charge.buildiumChargeId}` : ""}
                {charge.postedAt ? ` · ${formatDate(charge.postedAt)}` : ""}
              </span>
              <StatusPill tone={POST_TONE.posted}>{postLabel.posted}</StatusPill>
            </>
          ) : charge.postStatus === "skipped" ? (
            <>
              <StatusPill tone={POST_TONE.skipped}>{postLabel.skipped}</StatusPill>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => rpc.workspace.utilities.charge.save(key))}
                className={`text-[#85858A] ${CLICKABLE_TEXT}`}
              >
                <Trans>Restore</Trans>
              </button>
            </>
          ) : (
            <>
              {charge.postStatus === "error" ? (
                <StatusPill tone={POST_TONE.error}>{postLabel.error}</StatusPill>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => rpc.workspace.utilities.charge.skip(key))}
                className={`text-[#85858A] ${CLICKABLE_TEXT}`}
              >
                <Trans>Skip</Trans>
              </button>
              <BuiButton tone="accent" disabled={busy} onClick={() => setConfirming(true)}>
                {charge.postStatus === "error" ? t`Retry` : t`Post to Buildium`}
              </BuiButton>
            </>
          )}
        </span>
      </div>
      {charge.postStatus === "error" && charge.postError && !error ? (
        <p className="mt-1 text-[11.5px] text-[#F87171]">{charge.postError}</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-[11.5px] text-[#E8A33C]">
          {error}
          {needsSettings(error) ? (
            <>
              {" · "}
              <SettingsLink />
            </>
          ) : null}
        </p>
      ) : null}
      {confirming ? (
        <div className="mt-2">
          <ConfirmCard
            title={t`Post this charge to Buildium?`}
            lines={[
              { label: t`Unit`, value: unitLabel },
              { label: t`Amount`, value: amount === "" ? "—" : formatMoney(Number(amount)) },
              { label: t`Memo`, value: memo.trim() || "—" },
              { label: t`Date`, value: formatDate(today()) },
            ]}
            confirmLabel={t`Post`}
            cancelLabel={t`Cancel`}
            busy={busy}
            onConfirm={() => void post()}
            onCancel={() => setConfirming(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
