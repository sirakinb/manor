import { Trans, useLingui } from "@lingui/react/macro";
import {
  REPORT_ACTION_SECTION,
  REPORT_BULLET_SECTIONS,
  REPORT_EDIT_LIMITS,
  type ReportEditItem,
  type WorkspaceReport,
  type WorkspaceReportRow,
  type WorkspaceSummary,
} from "@rakazo/contracts";
import { useState } from "react";
import { BuiButton, SuccessPop } from "../../../components/beautiful-ui/primitives";
import { rpc } from "../../../lib/rpc";
import {
  Card,
  CLICKABLE_TEXT,
  ConfirmCard,
  ErrorLine,
  errorMessage,
  Field,
  formatDate,
  formatDateTime,
  humanizeKey,
  INPUT,
  isRecord,
  KeyValueTree,
  Loading,
  PageHeader,
  type PillTone,
  Section,
  StatusPill,
  Table,
  useSectionData,
} from "../bits";
import type { WorkspaceTab } from "../WorkspaceView";

/** Sent beats approved beats the row's own status ("draft", "final", "generating", "error"). */
function stageOf(row: WorkspaceReportRow): { label: string; tone: PillTone; key: string } {
  if (row.sentAt) return { key: "sent", label: "Sent", tone: "accent" };
  if (row.approvedAt) return { key: "approved", label: "Approved", tone: "good" };
  const status = row.status.trim().toLowerCase();
  const tone: PillTone = status === "error" ? "bad" : status === "generating" ? "warn" : "dim";
  return { key: status, label: status.charAt(0).toUpperCase() + status.slice(1), tone };
}

function StagePill({ row }: { row: WorkspaceReportRow }) {
  const { t } = useLingui();
  const stage = stageOf(row);
  const known: Record<string, string> = {
    sent: t`Sent`,
    approved: t`Approved`,
    draft: t`Draft`,
    final: t`Final`,
    generating: t`Generating`,
    error: t`Error`,
  };
  return <StatusPill tone={stage.tone}>{known[stage.key] ?? stage.label}</StatusPill>;
}

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
                width: "38%",
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
                key: "status",
                label: t`Status`,
                nowrap: true,
                render: (row) => (
                  <span className="flex items-center gap-2">
                    <StagePill row={row} />
                    <span className="text-[11.5px] text-[#6E6975]">
                      {row.sentAt
                        ? formatDate(row.sentAt)
                        : row.approvedAt
                          ? formatDate(row.approvedAt)
                          : ""}
                    </span>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

type Mode = "view" | "edit" | "approve" | "send" | "delete";

function ReportDetail({ reportId, onBack }: { reportId: string; onBack: () => void }) {
  const { t } = useLingui();
  const { data, error, loading, setData } = useSectionData<WorkspaceReport>(
    () => rpc.workspace.reports.get({ reportId }),
    reportId,
  );
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string[] | null>(null);

  async function act(action: () => Promise<WorkspaceReport | null>) {
    setBusy(true);
    setActionError(null);
    try {
      const next = await action();
      if (next) setData(next);
      setMode("view");
    } catch (cause) {
      setActionError(errorMessage(cause, t`Could not update the report`));
    } finally {
      setBusy(false);
    }
  }

  const report = data;
  const editable = report ? !report.approvedAt : false;
  const synthesis =
    report && isRecord(report.report) && isRecord(report.report.synthesis)
      ? report.report.synthesis
      : null;
  const editableSections = synthesis
    ? [...REPORT_BULLET_SECTIONS, REPORT_ACTION_SECTION].filter((section) => section in synthesis)
    : [];

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
      {report ? (
        <>
          <PageHeader
            title={report.title}
            subtitle={`${humanizeKey(report.reportType)} · ${formatDate(report.dateRangeStart)} – ${formatDate(report.dateRangeEnd)}${
              report.sentTo ? ` · ${t`Sent to ${report.sentTo}`}` : ""
            }`}
          >
            <StagePill row={report} />
            {mode === "view" ? (
              <>
                {editable ? (
                  <BuiButton disabled={busy} onClick={() => setMode("edit")}>
                    {t`Edit`}
                  </BuiButton>
                ) : null}
                {editable ? (
                  <BuiButton disabled={busy} onClick={() => setMode("approve")}>
                    {t`Approve`}
                  </BuiButton>
                ) : null}
                <BuiButton tone="accent" disabled={busy} onClick={() => setMode("send")}>
                  {report.sentAt ? t`Send again` : t`Send`}
                </BuiButton>
                {report.status === "draft" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setMode("delete")}
                    className={`text-[12.5px] text-[#85858A] ${CLICKABLE_TEXT}`}
                  >
                    <Trans>Delete</Trans>
                  </button>
                ) : null}
              </>
            ) : null}
          </PageHeader>

          {actionError && mode === "view" ? <ErrorLine message={actionError} /> : null}
          {sentTo ? (
            <div className="mb-3 flex items-center gap-3">
              <SuccessPop label={t`Sent to ${sentTo.join(", ")}`} />
              <button
                type="button"
                onClick={() => setSentTo(null)}
                className={`text-[12px] text-[#85858A] ${CLICKABLE_TEXT}`}
              >
                <Trans>Dismiss</Trans>
              </button>
            </div>
          ) : null}

          {mode === "approve" ? (
            <div className="mb-4">
              <ConfirmCard
                title={t`Approve this report?`}
                lines={[{ label: t`Report`, value: report.title }]}
                confirmLabel={t`Approve`}
                cancelLabel={t`Cancel`}
                busy={busy}
                error={actionError}
                onConfirm={() => void act(() => rpc.workspace.reports.approve({ reportId }))}
                onCancel={() => setMode("view")}
              />
            </div>
          ) : null}
          {mode === "delete" ? (
            <div className="mb-4">
              <ConfirmCard
                title={t`Delete this draft?`}
                lines={[{ label: t`Report`, value: report.title }]}
                confirmLabel={t`Delete`}
                cancelLabel={t`Cancel`}
                tone="neutral"
                busy={busy}
                error={actionError}
                onConfirm={() =>
                  void act(async () => {
                    await rpc.workspace.reports.remove({ reportId });
                    onBack();
                    return null;
                  })
                }
                onCancel={() => setMode("view")}
              />
            </div>
          ) : null}
          {mode === "send" ? (
            <div className="mb-4">
              <SendCard
                busy={busy}
                error={actionError}
                onCancel={() => setMode("view")}
                onSend={(to) =>
                  void act(async () => {
                    const result = await rpc.workspace.reports.send({ reportId, to });
                    if (result.error) {
                      setActionError(result.error);
                    }
                    if (result.sent.length) setSentTo(result.sent);
                    return result.report;
                  })
                }
              />
            </div>
          ) : null}

          {mode === "edit" ? (
            <ReportEditor
              report={report}
              synthesis={synthesis}
              sections={editableSections}
              busy={busy}
              error={actionError}
              onCancel={() => {
                setMode("view");
                setActionError(null);
              }}
              onSave={(input) =>
                void act(() => rpc.workspace.reports.update({ reportId, ...input }))
              }
            />
          ) : (
            <div className="space-y-3">
              {report.summary ? (
                <Section title={t`Summary`}>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#C9C9CE]">
                    {report.summary}
                  </p>
                </Section>
              ) : null}
              <ReportBody report={report.report} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// ── Send ─────────────────────────────────────────────────────────────────────

function splitRecipients(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes("@"));
}

function SendCard({
  busy,
  error,
  onSend,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSend: (to: string[]) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const settings = useSectionData(() => rpc.workspace.settings.get(), "send-recipients");
  const [chips, setChips] = useState<string[] | null>(null);
  const [entry, setEntry] = useState("");
  const recipients = chips ?? splitRecipients(settings.data?.reportRecipient);

  function add() {
    const next = splitRecipients(entry);
    if (next.length === 0) return;
    setChips([...new Set([...recipients, ...next])]);
    setEntry("");
  }

  return (
    <div
      className="rounded-[16px] border border-[#343438] p-4"
      role="dialog"
      aria-label={t`Send report`}
      style={{ background: "var(--bui-surface)" }}
    >
      <p className="text-[13.5px] font-medium text-[#ECECEE]">
        <Trans>Send this report</Trans>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {recipients.map((address) => (
          <span
            key={address}
            className="inline-flex items-center gap-1 rounded-full bg-[#1A1A1D] px-2 py-0.5 text-[12px] text-[#C9C9CE]"
          >
            {address}
            <button
              type="button"
              aria-label={t`Remove ${address}`}
              onClick={() => setChips(recipients.filter((item) => item !== address))}
              className={`text-[#6E6975] ${CLICKABLE_TEXT}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className={`${INPUT} w-[240px]`}
          type="email"
          value={entry}
          placeholder={t`Add an address`}
          aria-label={t`Add an address`}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
      {error ? <p className="mt-2 text-[12.5px] text-[#E8A33C]">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <BuiButton disabled={busy} onClick={onCancel}>
          {t`Cancel`}
        </BuiButton>
        <BuiButton
          tone="accent"
          disabled={busy || recipients.length === 0}
          onClick={() => onSend(recipients)}
        >
          {t`Send`}
        </BuiButton>
      </div>
    </div>
  );
}

// ── Edit ─────────────────────────────────────────────────────────────────────

type EditItem = Required<Pick<ReportEditItem, "title">> & ReportEditItem;

function itemsOf(value: unknown): EditItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    isRecord(entry)
      ? {
          title: String(entry.title ?? ""),
          detail: String(entry.detail ?? entry.description ?? ""),
          severity: typeof entry.severity === "string" ? entry.severity : undefined,
          priority: typeof entry.priority === "string" ? entry.priority : undefined,
          action_type: typeof entry.action_type === "string" ? entry.action_type : undefined,
        }
      : { title: String(entry ?? ""), detail: "" },
  );
}

function ReportEditor({
  report,
  synthesis,
  sections,
  busy,
  error,
  onSave,
  onCancel,
}: {
  report: WorkspaceReport;
  synthesis: Record<string, unknown> | null;
  sections: string[];
  busy: boolean;
  error: string | null;
  onSave: (input: {
    title?: string;
    summary?: string;
    sections?: Record<string, ReportEditItem[]>;
  }) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [title, setTitle] = useState(report.title);
  const [summary, setSummary] = useState(report.summary ?? "");
  const [lists, setLists] = useState<Record<string, EditItem[]>>(() =>
    Object.fromEntries(sections.map((section) => [section, itemsOf(synthesis?.[section])])),
  );

  function update(section: string, index: number, patch: Partial<EditItem>) {
    setLists((current) => ({
      ...current,
      [section]: current[section]!.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  return (
    <div className="space-y-4">
      <Card title={t`Edit report`}>
        <div className="space-y-3">
          <Field label={t`Title`}>
            <input
              className={INPUT}
              maxLength={REPORT_EDIT_LIMITS.title}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label={t`Summary`}>
            <textarea
              className={`${INPUT} min-h-[96px]`}
              maxLength={REPORT_EDIT_LIMITS.summary}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
        </div>
      </Card>
      {sections.map((section) => {
        const items = lists[section] ?? [];
        const isActions = section === REPORT_ACTION_SECTION;
        return (
          <Card
            key={section}
            title={humanizeKey(section)}
            right={
              <button
                type="button"
                disabled={items.length >= REPORT_EDIT_LIMITS.items}
                onClick={() =>
                  setLists((current) => ({
                    ...current,
                    [section]: [...(current[section] ?? []), { title: "", detail: "" }],
                  }))
                }
                className={`text-[12.5px] text-[#85858A] disabled:opacity-50 ${CLICKABLE_TEXT}`}
              >
                <Trans>Add item</Trans>
              </button>
            }
          >
            {items.length === 0 ? (
              <p className="text-[12.5px] text-[#6E6975]">
                <Trans>No items</Trans>
              </p>
            ) : (
              <ol className="space-y-3">
                {items.map((item, index) => (
                  <li key={index} className="rounded-lg border border-[#1C1C1F] p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <input
                          className={INPUT}
                          aria-label={t`Title`}
                          placeholder={t`Title`}
                          maxLength={REPORT_EDIT_LIMITS.title}
                          value={item.title}
                          onChange={(event) =>
                            update(section, index, { title: event.target.value })
                          }
                        />
                        <textarea
                          className={`${INPUT} min-h-[64px]`}
                          aria-label={t`Detail`}
                          placeholder={t`Detail`}
                          maxLength={REPORT_EDIT_LIMITS.detail}
                          value={item.detail ?? ""}
                          onChange={(event) =>
                            update(section, index, { detail: event.target.value })
                          }
                        />
                        {isActions ? (
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              className={INPUT}
                              aria-label={t`Priority`}
                              value={item.priority ?? "medium"}
                              onChange={(event) =>
                                update(section, index, { priority: event.target.value })
                              }
                            >
                              <option value="low">{t`Low`}</option>
                              <option value="medium">{t`Medium`}</option>
                              <option value="high">{t`High`}</option>
                            </select>
                            <input
                              className={INPUT}
                              aria-label={t`Action type`}
                              placeholder={t`Action type`}
                              maxLength={60}
                              value={item.action_type ?? ""}
                              onChange={(event) =>
                                update(section, index, { action_type: event.target.value })
                              }
                            />
                          </div>
                        ) : section === "list_health_flags" ? (
                          <select
                            className={`${INPUT} w-[160px]`}
                            aria-label={t`Severity`}
                            value={item.severity ?? "low"}
                            onChange={(event) =>
                              update(section, index, { severity: event.target.value })
                            }
                          >
                            <option value="low">{t`Low`}</option>
                            <option value="medium">{t`Medium`}</option>
                            <option value="high">{t`High`}</option>
                          </select>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        aria-label={t`Remove item`}
                        onClick={() =>
                          setLists((current) => ({
                            ...current,
                            [section]: current[section]!.filter((_, i) => i !== index),
                          }))
                        }
                        className={`text-[#6E6975] ${CLICKABLE_TEXT}`}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        );
      })}
      {error ? <ErrorLine message={error} /> : null}
      <div className="flex justify-end gap-2">
        <BuiButton disabled={busy} onClick={onCancel}>
          {t`Cancel`}
        </BuiButton>
        <BuiButton
          tone="accent"
          disabled={busy || !title.trim()}
          onClick={() =>
            onSave({
              title: title.trim(),
              ...(summary.trim() ? { summary: summary.trim() } : {}),
              ...(sections.length
                ? {
                    sections: Object.fromEntries(
                      sections.map((section) => [
                        section,
                        (lists[section] ?? [])
                          .map((item) => ({
                            ...item,
                            title: item.title.slice(0, REPORT_EDIT_LIMITS.title),
                            detail: (item.detail ?? "").slice(0, REPORT_EDIT_LIMITS.detail),
                          }))
                          .filter((item) => item.title.trim() || item.detail?.trim())
                          .slice(0, REPORT_EDIT_LIMITS.items),
                      ]),
                    ),
                  }
                : {}),
            })
          }
        >
          {t`Save`}
        </BuiButton>
      </div>
    </div>
  );
}

// ── Read view ────────────────────────────────────────────────────────────────

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
  // On-demand voice/email reports: { stats, synthesis, agent_type }.
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
        ) : isRecord(synthesis) ? (
          Object.entries(synthesis).map(([key, value]) => (
            <Section key={key} title={humanizeKey(key)}>
              {typeof value === "string" ? (
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#C9C9CE]">
                  {value}
                </p>
              ) : (
                <KeyValueTree value={value} />
              )}
            </Section>
          ))
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
