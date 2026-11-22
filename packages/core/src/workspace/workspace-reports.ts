/**
 * Workspace report editing rules and the emailed HTML. Pure: no database, no
 * provider. Ported from the old app's report-edit and report-email modules,
 * trimmed to what the owner actually uses.
 */

import {
  REPORT_ACTION_SECTION,
  REPORT_BULLET_SECTIONS,
  REPORT_EDIT_LIMITS,
} from "@rakazo/contracts";

const SEVERITIES = ["low", "medium", "high"] as const;

export type ReportEditItem = {
  title?: string;
  detail?: string;
  description?: string;
  severity?: string;
  priority?: string;
  action_type?: string;
};

export type ReportBullet = { title: string; detail: string; severity?: string };
export type ReportAction = {
  title: string;
  description: string;
  priority: string;
  action_type: string;
};

const clamp = (value: unknown, max: number): string =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const vocab = (value: unknown, fallback: string): string => {
  const lower = String(value ?? "").toLowerCase();
  return (SEVERITIES as readonly string[]).includes(lower) ? lower : fallback;
};

export class ReportEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportEditError";
  }
}

/** Replace one synthesis section wholesale, applying the old caps and vocabularies. */
export function sanitizeReportSection(
  section: string,
  items: ReportEditItem[],
): ReportBullet[] | ReportAction[] {
  const list = (Array.isArray(items) ? items : []).slice(0, REPORT_EDIT_LIMITS.items);
  if (section === REPORT_ACTION_SECTION) {
    return list
      .map((item) => ({
        title: clamp(item?.title, REPORT_EDIT_LIMITS.title),
        description: clamp(item?.description ?? item?.detail, REPORT_EDIT_LIMITS.detail),
        priority: vocab(item?.priority, "medium"),
        action_type: clamp(item?.action_type, 60) || "follow_up",
      }))
      .filter((item) => item.title || item.description);
  }
  if (!(REPORT_BULLET_SECTIONS as readonly string[]).includes(section)) {
    throw new ReportEditError(`Unknown section: ${section}`);
  }
  return list
    .map((item) => {
      const row: ReportBullet = {
        title: clamp(item?.title, REPORT_EDIT_LIMITS.title),
        detail: clamp(item?.detail ?? item?.description, REPORT_EDIT_LIMITS.detail),
      };
      // Only list_health_flags carries a severity chip.
      if (section === "list_health_flags") row.severity = vocab(item?.severity, "low");
      return row;
    })
    .filter((item) => item.title || item.detail);
}

/**
 * The report JSON with the given sections replaced. Throws when the report
 * has no synthesis block (nothing is editable) or a section is unknown.
 */
export function applyReportSectionEdits(
  report: unknown,
  sections: Record<string, ReportEditItem[]>,
): Record<string, unknown> {
  const json = report && typeof report === "object" ? (report as Record<string, unknown>) : {};
  const synthesis = json.synthesis;
  if (!synthesis || typeof synthesis !== "object") {
    throw new ReportEditError("This report has no editable sections");
  }
  const next = { ...(synthesis as Record<string, unknown>) };
  for (const [section, items] of Object.entries(sections)) {
    next[section] = sanitizeReportSection(section, items);
  }
  return { ...json, synthesis: next };
}

// ── Email rendering ──────────────────────────────────────────────────────────

const NAVY = "#21384a";
const CREAM = "#f7f4ed";
const TEAL = "#2f8f83";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const compact = (value: number): string =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 10_000
      ? `${Math.round(value / 1000)}k`
      : value.toLocaleString("en-US");

function stat(label: string, value: string, sub = ""): string {
  return (
    `<td style="padding:14px 16px;background:${CREAM};border-radius:10px;vertical-align:top;width:25%">` +
    `<div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7a83">${escapeHtml(label)}</div>` +
    `<div style="font-size:24px;font-weight:700;color:${NAVY};margin-top:4px">${escapeHtml(value)}</div>` +
    `<div style="font-size:11px;color:#6b7a83;margin-top:2px">${escapeHtml(sub)}</div></td>`
  );
}

function section(title: string, inner: string): string {
  return (
    `<div style="margin-top:26px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;` +
    `text-transform:uppercase;color:${NAVY};border-bottom:2px solid ${NAVY}22;padding-bottom:6px">${escapeHtml(title)}</div>` +
    `<div style="margin-top:10px">${inner}</div></div>`
  );
}

function bullets(items: unknown): string {
  const list = Array.isArray(items) ? (items as ReportEditItem[]) : [];
  if (list.length === 0) {
    return `<p style="font-size:13px;color:#6b7a83;margin:0">Nothing to report.</p>`;
  }
  return list
    .map(
      (item) =>
        `<div style="margin:0 0 10px 0"><div style="font-size:14px;font-weight:600;color:#1b2a35">${escapeHtml(item.title)}</div>` +
        `<div style="font-size:13px;color:#4a5a64;line-height:1.5">${escapeHtml(item.detail ?? item.description ?? "")}</div></div>`,
    )
    .join("");
}

function numbered(items: unknown): string {
  const list = Array.isArray(items) ? (items as ReportEditItem[]) : [];
  if (list.length === 0) {
    return `<p style="font-size:13px;color:#6b7a83;margin:0">Nothing to report.</p>`;
  }
  return list
    .map((item, index) => {
      const priority = item.priority ? String(item.priority) : "";
      const color = priority === "high" ? "#b3543f" : priority === "medium" ? "#a07425" : "#6b7a83";
      return (
        `<div style="margin:0 0 12px 0"><div style="font-size:14px;font-weight:600;color:#1b2a35">` +
        `<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;` +
        `background:${NAVY}14;border-radius:50%;font-size:11px;font-weight:700;color:${NAVY};margin-right:8px">${index + 1}</span>` +
        `${escapeHtml(item.title)}${priority ? ` <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${color}">· ${escapeHtml(priority)}</span>` : ""}</div>` +
        `<div style="font-size:13px;color:#4a5a64;line-height:1.5;margin-left:28px">${escapeHtml(item.description ?? item.detail ?? "")}</div></div>`
      );
    })
    .join("");
}

const SECTION_TITLES: Record<string, string> = {
  what_worked: "What worked",
  what_underperformed: "What underperformed",
  link_insights: "Link insights",
  list_health_flags: "List health",
  urgent_followups: "Urgent follow-ups",
  top_call_reasons: "Top call reasons",
};

export type RenderableReport = {
  reportType: string;
  title: string;
  summary: string | null;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  report: unknown;
};

const day = (value: string | null): string => (value ? value.slice(0, 10) : "");

export function reportLabel(reportType: string): string {
  if (reportType === "email") return "Email Campaign Report";
  if (reportType === "voice_monthly") return "Monthly Voice Recap";
  return "Voice Report";
}

/** Period text for the header: the explicit range, or the monthly period inside the JSON. */
export function reportPeriod(report: RenderableReport): string {
  const json = asRecord(report.report);
  const metrics = asRecord(json.metrics);
  const period = asRecord(metrics.period);
  if (typeof period.month_name === "string" && period.year) {
    return `${period.month_name} ${period.year}`;
  }
  const start = day(report.dateRangeStart);
  const end = day(report.dateRangeEnd);
  return start && end ? `${start} – ${end}` : start || end;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function kpis(cells: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:18px"><tr>${cells.join("")}</tr></table>`;
}

function emailBody(json: Record<string, unknown>): string {
  const agg = asRecord(json.agg);
  const synthesis = asRecord(json.synthesis);
  const links = (Array.isArray(json.top_links) ? json.top_links : [])
    .slice(0, 6)
    .map((raw) => {
      const link = asRecord(raw);
      let host = String(link.url ?? "");
      let path = "";
      try {
        const url = new URL(String(link.url));
        host = url.host;
        path = url.pathname === "/" ? "" : url.pathname;
      } catch {
        // keep the raw text
      }
      return (
        `<div style="margin:0 0 8px 0"><span style="font-size:13px;font-weight:600;color:${NAVY}">${escapeHtml(host)}</span>` +
        `<span style="font-size:13px;color:#6b7a83">${escapeHtml(path)}</span>` +
        `<span style="float:right;font-size:13px;font-weight:700;color:${TEAL}">${num(link.totalClicks)} clicks · ${num(link.uniqueClickers)} people</span></div>` +
        `<div style="clear:both"></div>`
      );
    })
    .join("");
  const delivered = num(agg.delivered);
  return (
    kpis([
      stat("Campaigns", String(num(agg.campaigns))),
      stat("Delivered", compact(delivered), `${num(agg.deliveredRate).toFixed(1)}% of sent`),
      stat("Open rate", `${num(agg.openRate).toFixed(1)}%`, `${compact(num(agg.opens))} opens`),
      stat("Clicks", compact(num(agg.clicks)), `${num(agg.ctor).toFixed(1)}% of openers`),
    ]) +
    section(SECTION_TITLES.what_worked!, bullets(synthesis.what_worked)) +
    section(SECTION_TITLES.what_underperformed!, bullets(synthesis.what_underperformed)) +
    (links ? section("Top clicked links", links) : "") +
    section("Recommended next steps", numbered(synthesis.recommended_actions))
  );
}

function voiceBody(json: Record<string, unknown>): string {
  const synthesis = asRecord(json.synthesis);
  const stats = asRecord(json.stats);
  const headline = asRecord(asRecord(json.metrics).headline);
  const total = num(stats.total_calls ?? headline.total_calls);
  const ai = num(stats.ai_handled_calls ?? headline.ai_handled);
  const callbacks = num(stats.callback_requested_calls ?? headline.follow_up);
  const reasons = Array.isArray(synthesis.top_call_reasons)
    ? (synthesis.top_call_reasons as Record<string, unknown>[])
        .slice(0, 6)
        .map(
          (reason) =>
            `<div style="margin:0 0 6px 0;font-size:13px;color:#1b2a35"><b>${escapeHtml(reason.reason)}</b>` +
            `<span style="float:right;color:#6b7a83">${escapeHtml(reason.count)} calls</span></div><div style="clear:both"></div>`,
        )
        .join("")
    : "";
  const categories = Array.isArray(asRecord(json.metrics).categories)
    ? (asRecord(json.metrics).categories as Record<string, unknown>[])
        .slice(0, 6)
        .map(
          (category) =>
            `<div style="margin:0 0 6px 0;font-size:13px;color:#1b2a35"><b>${escapeHtml(category.label)}</b>` +
            `<span style="float:right;color:#6b7a83">${escapeHtml(category.count)} calls · ${escapeHtml(category.pct)}%</span></div><div style="clear:both"></div>`,
        )
        .join("")
    : "";
  return (
    kpis([
      stat("Total calls", total.toLocaleString("en-US")),
      stat(
        "AI handled",
        ai.toLocaleString("en-US"),
        total ? `${Math.round((100 * ai) / total)}% of calls` : "",
      ),
      stat("Follow-ups", callbacks.toLocaleString("en-US")),
    ]) +
    (reasons ? section(SECTION_TITLES.top_call_reasons!, reasons) : "") +
    (categories ? section("Call mix", categories) : "") +
    (synthesis.what_worked
      ? section(SECTION_TITLES.what_worked!, bullets(synthesis.what_worked))
      : "") +
    (synthesis.what_underperformed
      ? section(SECTION_TITLES.what_underperformed!, bullets(synthesis.what_underperformed))
      : "") +
    (synthesis.urgent_followups
      ? section(SECTION_TITLES.urgent_followups!, bullets(synthesis.urgent_followups))
      : "") +
    (synthesis.recommended_actions
      ? section("Recommended actions", numbered(synthesis.recommended_actions))
      : "")
  );
}

/** Email-safe HTML: table layout, inline styles, nothing external. */
export function renderReportEmailHtml(input: {
  workspaceName: string;
  report: RenderableReport;
  reportUrl?: string | null;
}): string {
  const json = asRecord(input.report.report);
  const body = input.report.reportType === "email" ? emailBody(json) : voiceBody(json);
  const summary = input.report.summary?.trim();
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 0">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">
<tr><td style="background:${NAVY};border-radius:14px 14px 0 0;padding:26px 30px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#ffffff99">${escapeHtml(input.workspaceName)} · ${escapeHtml(reportLabel(input.report.reportType))}</div>
  <div style="font-size:22px;font-weight:700;color:#fff;margin-top:6px">${escapeHtml(input.report.title)}</div>
  <div style="font-size:13px;color:#ffffffb3;margin-top:4px">${escapeHtml(reportPeriod(input.report))}</div>
</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:26px 30px">
  ${summary ? `<div style="border-left:4px solid ${NAVY};padding:2px 0 2px 14px;font-size:14px;line-height:1.6;color:#1b2a35">${escapeHtml(summary)}</div>` : ""}
  ${body}
  ${
    input.reportUrl
      ? `<div style="margin-top:30px;text-align:center"><a href="${escapeHtml(input.reportUrl)}" style="display:inline-block;background:${NAVY};color:#fff;font-size:13px;font-weight:600;padding:11px 22px;border-radius:9px;text-decoration:none">View the full report</a></div>`
      : ""
  }
</td></tr>
<tr><td style="padding:16px 8px;text-align:center;font-size:11px;color:#6b7a83">${escapeHtml(input.workspaceName)} · Performance Report</td></tr>
</table>
</td></tr></table></body></html>`;
}

/** Plain-text twin for clients that do not render HTML. */
export function renderReportEmailText(input: {
  workspaceName: string;
  report: RenderableReport;
}): string {
  const lines = [
    `${input.workspaceName} · ${reportLabel(input.report.reportType)}`,
    input.report.title,
    reportPeriod(input.report),
  ];
  if (input.report.summary?.trim()) lines.push("", input.report.summary.trim());
  return lines.join("\n");
}

/** Merge new recipients into the stored comma-separated list, keeping order and dropping repeats. */
export function mergeRecipients(existing: string | null, sent: string[]): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const address of [...(existing ?? "").split(/[,;\s]+/), ...sent]) {
    const trimmed = address.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged.join(", ");
}
