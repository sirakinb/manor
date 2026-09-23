import { describe, expect, it } from "vitest";
import {
  calendarUrl,
  createRateLimiter,
  describeEventTime,
  eventConfirmation,
  joinLabel,
  scoreScorecard,
  slugFromPath,
} from "./public-forms.js";

const form = {
  id: "f1",
  organizationId: "o1",
  slug: "demo-night",
  kind: "event",
  title: "Demo Night",
  enabled: true,
  crmTag: "Demo Night",
  allowedOrigins: ["https://example.com"],
  message: "Bring <questions> & ideas.",
  notifyEmail: null,
  senderName: "Host",
  signature: "Sam",
  eventStartsAt: new Date("2026-09-24T23:00:00.000Z"),
  eventMinutes: 60,
  eventTimeZone: "America/New_York",
  joinUrl: "https://us06web.zoom.us/j/1234567890",
  bookingUrl: null,
};

describe("slugFromPath", () => {
  it("reads the slug from the long and short public paths", () => {
    expect(slugFromPath("/v1/public/forms/demo-night")).toBe("demo-night");
    expect(slugFromPath("/v1/public/demo-night")).toBe("demo-night");
    expect(slugFromPath("/v1/public/forms/Bad Slug")).toBeNull();
    expect(slugFromPath("/v1/crm/contacts")).toBeNull();
  });
});

describe("createRateLimiter", () => {
  it("allows a burst per key and resets after the window", () => {
    let now = 0;
    const allow = createRateLimiter(2, 1_000, () => now);
    expect([allow("a"), allow("a"), allow("a"), allow("b")]).toEqual([true, true, false, true]);
    now = 1_000;
    expect(allow("a")).toBe(true);
  });
});

describe("event details", () => {
  it("describes the event in its own time zone", () => {
    expect(describeEventTime(form.eventStartsAt, 60, "America/New_York")).toBe(
      "Thursday, September 24, 7:00 to 8:00 PM EDT",
    );
    expect(describeEventTime(form.eventStartsAt, null, "UTC")).toBe(
      "Thursday, September 24, 11:00 PM UTC",
    );
  });

  it("builds a calendar link with the event window and join link", () => {
    const url = new URL(calendarUrl(form)!);
    expect(url.searchParams.get("dates")).toBe("20260924T230000Z/20260925T000000Z");
    expect(url.searchParams.get("ctz")).toBe("America/New_York");
    expect(url.searchParams.get("location")).toBe(form.joinUrl);
  });

  it("labels the join button by service", () => {
    expect(joinLabel("https://us06web.zoom.us/j/1")).toBe("Join on Zoom");
    expect(joinLabel("https://meet.google.com/abc")).toBe("Join on Google Meet");
    expect(joinLabel("https://example.com/live")).toBe("Join");
  });

  it("writes the confirmation from the form settings and escapes HTML", () => {
    const message = eventConfirmation(form, "Ada <b>");
    expect(message.subject).toBe("You're in: Demo Night");
    expect(message.text).toContain(form.joinUrl);
    expect(message.text).toContain("Thursday, September 24, 7:00 to 8:00 PM EDT");
    expect(message.text).toContain("Bring <questions> & ideas.");
    expect(message.text).toContain("- Sam");
    expect(message.html).toContain("Hey Ada &lt;b&gt;,");
    expect(message.html).toContain("Bring &lt;questions&gt; &amp; ideas.");
    expect(message.html).toContain("Join on Zoom");
  });
});

describe("scoreScorecard", () => {
  it("scores answers at 0, 2, or 3 points and picks a band", () => {
    const answers = Array.from({ length: 12 }, (_, index) => ({
      question: `Q${index + 1}`,
      value: index < 6 ? 3 : 2,
    }));
    expect(
      scoreScorecard({ name: "Ada", email: "ada@example.com", score: 0, answers }),
    ).toMatchObject({ score: 30, band: "Ready for advanced automation" });
    expect(
      scoreScorecard({
        name: "Ada",
        email: "ada@example.com",
        score: 0,
        answers: [
          { question: "Invoices", value: 2 },
          { question: "Follow-ups", value: 7 },
        ],
      }),
    ).toEqual({
      score: 2,
      band: "Foundation first",
      answerLines: ["1. Partially handled: Invoices", "2. Unanswered: Follow-ups"],
    });
  });

  it("falls back to the submitted score without answers", () => {
    expect(scoreScorecard({ name: "Ada", email: "ada@example.com", score: 20 }).band).toBe(
      "Ready to automate one workflow",
    );
  });
});
