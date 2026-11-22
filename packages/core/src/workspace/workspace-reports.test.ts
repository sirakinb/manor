import { describe, expect, it } from "vitest";
import {
  applyReportSectionEdits,
  mergeRecipients,
  renderReportEmailHtml,
  renderReportEmailText,
  reportPeriod,
  sanitizeReportSection,
} from "./workspace-reports.js";

const emailReport = {
  reportType: "email",
  title: "Weekly Email Recap · 2026-08-24 – 2026-08-30",
  summary: "Two campaigns went out & did well.",
  dateRangeStart: "2026-08-24T00:00:00.000Z",
  dateRangeEnd: "2026-08-30T00:00:00.000Z",
  report: {
    agg: {
      campaigns: 2,
      delivered: 147662,
      deliveredRate: 99.48,
      openRate: 4.33,
      opens: 6392,
      clicks: 384,
      ctor: 6.0,
    },
    top_links: [{ url: "https://www.reinfo411.com/rentals/", totalClicks: 75, uniqueClickers: 64 }],
    synthesis: {
      what_worked: [{ title: "Action subject line", detail: "5.5% opens <b>" }],
      what_underperformed: [],
      recommended_actions: [
        { title: "Clean the list", description: "Drop hard bounces", priority: "high" },
      ],
    },
  },
};

describe("sanitizeReportSection", () => {
  it("caps items and lengths and keeps only the shape the renderer expects", () => {
    const items = Array.from({ length: 15 }, (_, index) => ({
      title: `t${index} ${"x".repeat(300)}`,
      detail: "d".repeat(2000),
      severity: "critical",
      priority: "high",
    }));
    const bullets = sanitizeReportSection("what_worked", items);
    expect(bullets).toHaveLength(12);
    const first = bullets[0] as { title: string; detail: string };
    expect(first.title).toHaveLength(200);
    expect(first.detail).toHaveLength(1200);
    expect(bullets[0]).not.toHaveProperty("severity");

    const flags = sanitizeReportSection("list_health_flags", [
      { title: "Hard bounces", severity: "HIGH" },
      { title: "Soft", severity: "bogus" },
    ]);
    expect(flags.map((flag) => (flag as { severity?: string }).severity)).toEqual(["high", "low"]);
  });

  it("normalizes recommended actions and drops empty rows", () => {
    const actions = sanitizeReportSection("recommended_actions", [
      { title: "Do it", detail: "via detail", priority: "urgent" },
      { title: "", description: "" },
    ]);
    expect(actions).toEqual([
      { title: "Do it", description: "via detail", priority: "medium", action_type: "follow_up" },
    ]);
  });

  it("refuses sections that are not prose", () => {
    expect(() => sanitizeReportSection("agg", [])).toThrow(/Unknown section/);
  });
});

describe("applyReportSectionEdits", () => {
  it("replaces only the named sections and leaves the numbers alone", () => {
    const next = applyReportSectionEdits(emailReport.report, {
      what_underperformed: [{ title: "Roundup", detail: "3.1% opens" }],
    });
    expect(next.agg).toEqual(emailReport.report.agg);
    const synthesis = next.synthesis as Record<string, unknown>;
    expect(synthesis.what_worked).toEqual(emailReport.report.synthesis.what_worked);
    expect(synthesis.what_underperformed).toEqual([{ title: "Roundup", detail: "3.1% opens" }]);
  });

  it("refuses a report without a synthesis block", () => {
    expect(() => applyReportSectionEdits({ metrics: {} }, { what_worked: [] })).toThrow(
      /no editable sections/,
    );
  });
});

describe("renderReportEmailHtml", () => {
  it("renders the email report with escaped prose, KPIs, links, and actions", () => {
    const html = renderReportEmailHtml({ workspaceName: "Jackson <Rentals>", report: emailReport });
    expect(html).toContain("Jackson &lt;Rentals&gt; · Email Campaign Report");
    expect(html).toContain("Weekly Email Recap");
    expect(html).toContain("2026-08-24 – 2026-08-30");
    expect(html).toContain("Two campaigns went out &amp; did well.");
    expect(html).toContain("148k");
    expect(html).toContain("4.3%");
    expect(html).toContain("5.5% opens &lt;b&gt;");
    expect(html).toContain("www.reinfo411.com");
    expect(html).toContain("75 clicks · 64 people");
    expect(html).toContain("Clean the list");
    expect(html).toContain("· high");
    expect(html).toContain("Nothing to report.");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
  });

  it("renders a monthly voice recap from its metrics block", () => {
    const html = renderReportEmailHtml({
      workspaceName: "JRH",
      report: {
        reportType: "voice_monthly",
        title: "Voice AI Recap · August 2026",
        summary: null,
        dateRangeStart: null,
        dateRangeEnd: null,
        report: {
          metrics: {
            period: { month_name: "August", year: 2026 },
            headline: { total_calls: 8, ai_handled: 3, follow_up: 5 },
            categories: [{ label: "Fee / pricing questions", count: 1, pct: 12.5 }],
          },
        },
      },
    });
    expect(html).toContain("JRH · Monthly Voice Recap");
    expect(html).toContain("August 2026");
    expect(html).toContain("38% of calls");
    expect(html).toContain("Fee / pricing questions");
    expect(html).toContain("1 calls · 12.5%");
  });

  it("has a plain-text twin and a period helper", () => {
    expect(renderReportEmailText({ workspaceName: "JRH", report: emailReport })).toBe(
      [
        "JRH · Email Campaign Report",
        emailReport.title,
        "2026-08-24 – 2026-08-30",
        "",
        "Two campaigns went out & did well.",
      ].join("\n"),
    );
    expect(reportPeriod({ ...emailReport, dateRangeEnd: null })).toBe("2026-08-24");
  });
});

describe("mergeRecipients", () => {
  it("keeps order, trims, and dedupes case-insensitively", () => {
    expect(mergeRecipients("a@x.test, B@x.test", ["b@x.test", "c@x.test", "c@x.test"])).toBe(
      "a@x.test, B@x.test, c@x.test",
    );
    expect(mergeRecipients(null, ["a@x.test"])).toBe("a@x.test");
  });
});
