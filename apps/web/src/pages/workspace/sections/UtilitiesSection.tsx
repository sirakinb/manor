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
  blocked: "warn",
  tenant_direct: "dim",
  owner_sends_bill: "dim",
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
  const [view, setView] = useState<"bills" | "properties">("properties");
  const [filter, setFilter] = useState<"all" | "pending" | "attention" | "unmatched" | "posted">(
    "all",
  );
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState<string | null>(null);

  const targetLabel: Record<UtilityBillingTarget["targetStatus"], string> = {
    blocked: t`Manual handling`,
    tenant_direct: t`Tenant pays directly`,
    owner_sends_bill: t`Owner sends bill`,
    resolved: t`Bill through Buildium`,
    ambiguous: t`Choose lease`,
    no_active_lease: t`No active lease`,
    unmatched: t`Match property`,
  };

  const resolved = data?.targets.filter((target) => target.targetStatus === "resolved").length ?? 0;
  const bills = data?.bills ?? [];
  const propertyIssues =
    data?.targets.filter((target) =>
      ["blocked", "unmatched", "no_active_lease", "ambiguous"].includes(target.targetStatus),
    ).length ?? 0;
  const unmatchedBills = bills.filter((bill) => bill.resolutionStatus === "unmatched").length;
  const selectedProperty = data?.targets.find(
    (target) => target.utilityPropertyId === propertyFilter,
  );
  const nextStep: Record<UtilityBillingTarget["targetStatus"], string> = {
    blocked: t`Handle manually using the billing instructions.`,
    tenant_direct: t`Tenant pays the utility provider. No ledger charge.`,
    owner_sends_bill: t`Obtain the bill from the owner and handle manually.`,
    resolved: t`Review the bill amount, then post to the tenant ledger.`,
    ambiguous: t`Confirm which lease to bill or how to split the charge.`,
    no_active_lease: t`Confirm the active lease in Buildium before charging.`,
    unmatched: t`Match this address to a Buildium property before charging.`,
  };
  const pendingCharges = bills
    .filter((bill) => bill.resolutionStatus === "resolved")
    .flatMap((bill) => bill.charges.filter((charge) => charge.postStatus === "pending"));
  const pendingTotal = pendingCharges.reduce((sum, charge) => sum + (charge.chargeAmount ?? 0), 0);
  const pendingBillCount = bills.filter((bill) =>
    bill.charges.some((charge) => charge.postStatus === "pending"),
  ).length;
  const query = search.trim().toLocaleLowerCase();
  const visibleBills = bills.filter((bill) => {
    if (propertyFilter && bill.utilityPropertyId !== propertyFilter) return false;
    if (
      query &&
      !`${bill.serviceAddress ?? ""} ${bill.billingMonth ?? ""}`.toLocaleLowerCase().includes(query)
    )
      return false;
    if (filter === "pending") return bill.charges.some((charge) => charge.postStatus === "pending");
    if (filter === "unmatched") return bill.resolutionStatus === "unmatched";
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

  function showPropertyBills(target: UtilityBillingTarget) {
    setPropertyFilter(target.utilityPropertyId);
    setSearch("");
    setFilter("all");
    setView("bills");
  }

  function showUnmatchedBills() {
    setView("bills");
    setFilter("unmatched");
    setSearch("");
    setPropertyFilter(null);
  }

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
      <PageHeader
        eyebrow={eyebrow}
        title={t`Utilities`}
        subtitle={t`${workspace.name} · Water billing`}
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
              label={t`Bill through Buildium`}
              value={formatNumber(resolved)}
              caption={t`matched to an active lease`}
            />
            <KpiTile
              label={t`Property issues`}
              value={formatNumber(propertyIssues)}
              caption={t`manual handling or setup needed`}
            />
            <KpiTile
              label={t`Bills to review`}
              value={formatNumber(pendingBillCount)}
              caption={t`${formatNumber(pendingCharges.length)} pending tenant charges`}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t`Utilities view`}
              value={view}
              onChange={(next) => {
                setView(next);
                setPropertyFilter(null);
                setSearch("");
              }}
              options={[
                { key: "properties", label: t`Properties` },
                { key: "bills", label: t`Bills` },
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
              title={selectedProperty ? selectedProperty.address : t`Water bills`}
              subtitle={
                selectedProperty
                  ? t`Review the bill and its tenant charges`
                  : t`${formatNumber(pendingCharges.length)} pending charges across ${formatNumber(pendingBillCount)} bills · ${formatMoney(pendingTotal)}`
              }
              className="mt-4"
              right={
                pendingCharges.length > 0 && !propertyFilter && !query && filter === "all" ? (
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
              {selectedProperty ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                  <span className="text-[var(--ws-muted)]">
                    {selectedProperty.notes ?? nextStep[selectedProperty.targetStatus]}
                  </span>
                  <BuiButton onClick={() => setPropertyFilter(null)}>
                    <Trans>Show all bills</Trans>
                  </BuiButton>
                </div>
              ) : null}
              <div className="mb-3 overflow-x-auto">
                <Segmented
                  label={t`Bill status`}
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { key: "all", label: t`All` },
                    { key: "pending", label: t`Pending` },
                    { key: "attention", label: t`Needs attention` },
                    { key: "unmatched", label: t`Unmatched` },
                    { key: "posted", label: t`Posted` },
                  ]}
                />
              </div>
              <p className="mb-2 text-[11.5px] text-[var(--ws-muted)]">{t`${formatNumber(visibleBills.length)} of ${formatNumber(bills.length)} bills`}</p>
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
                      statusLabel={
                        bill.resolutionStatus === "unmatched"
                          ? t`Unmatched bill`
                          : targetLabel[bill.resolutionStatus]
                      }
                      guidance={
                        bill.resolutionStatus === "unmatched"
                          ? t`Confirm this bill belongs on the property roster, then check the service address mapping.`
                          : nextStep[bill.resolutionStatus]
                      }
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
              subtitle={t`Billing instructions, tenant leases, and the next step for each property`}
              right={
                unmatchedBills > 0 ? (
                  <BuiButton onClick={showUnmatchedBills}>
                    {t`Unmatched bills (${formatNumber(unmatchedBills)})`}
                  </BuiButton>
                ) : null
              }
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
                    width: "26%",
                    render: (target) => (
                      <div>
                        <p className="font-medium text-[#ECECEE]">{target.address}</p>
                        {target.notes ? (
                          <p className="mt-1 max-w-64 text-[12px] leading-relaxed text-[var(--ws-muted)]">
                            {target.notes}
                          </p>
                        ) : null}
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
                    label: t`Lease / split`,
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

                                {target.leases.length > 1
                                  ? ` · ${t`${formatPct(lease.chargeShare * 100)} of bill`}`
                                  : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ),
                  },
                  {
                    key: "next",
                    label: t`Next step`,
                    width: "30%",
                    render: (target) => {
                      const propertyBills = bills.filter(
                        (bill) => bill.utilityPropertyId === target.utilityPropertyId,
                      );
                      const pending = propertyBills.filter((bill) =>
                        bill.charges.some(
                          (charge) =>
                            charge.postStatus === "pending" || charge.postStatus === "error",
                        ),
                      );
                      return (
                        <div className="space-y-1.5">
                          <p className="text-[12px] leading-relaxed text-[var(--ws-muted)]">
                            {target.targetStatus !== "resolved"
                              ? nextStep[target.targetStatus]
                              : pending.length
                                ? nextStep.resolved
                                : propertyBills.length
                                  ? t`No pending tenant charges. Review bill history if needed.`
                                  : unmatchedBills > 0
                                    ? t`No matched bill. Check the unmatched bills.`
                                    : t`Await the next water bill.`}
                          </p>
                          {propertyBills.length > 0 ? (
                            <button
                              type="button"
                              className={`text-[12px] font-medium text-[var(--ws-accent)] ${CLICKABLE_TEXT}`}
                              onClick={() => showPropertyBills(target)}
                            >
                              {pending.length === 1
                                ? t`Review bill`
                                : pending.length
                                  ? t`Review ${formatNumber(pending.length)} bills`
                                  : t`View bills`}
                            </button>
                          ) : target.targetStatus === "resolved" && unmatchedBills > 0 ? (
                            <button
                              type="button"
                              className={`text-[12px] font-medium text-[var(--ws-accent)] ${CLICKABLE_TEXT}`}
                              onClick={showUnmatchedBills}
                            >
                              <Trans>Check unmatched bills</Trans>
                            </button>
                          ) : null}
                        </div>
                      );
                    },
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
  guidance,
  onChanged,
  onPosted,
}: {
  bill: WaterBillGroup;
  statusLabel: string;
  guidance: string;
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
            {bill.charges.length > 1 ? ` · ${t`${bill.charges.length} charges`}` : ""}
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
      {bill.resolutionStatus !== "resolved" ? (
        <p className="mt-2 text-[12px] text-[var(--ws-muted)]">{guidance}</p>
      ) : null}
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
