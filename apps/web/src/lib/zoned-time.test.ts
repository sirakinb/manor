import { describe, expect, it } from "vitest";
import { isoToZonedLocal, zonedLocalToIso } from "./zoned-time";

describe("zoned time", () => {
  it("converts New York wall time to UTC across daylight saving", () => {
    expect(zonedLocalToIso("2026-09-24T19:00", "America/New_York")).toBe(
      "2026-09-24T23:00:00.000Z",
    );
    expect(zonedLocalToIso("2026-12-03T19:00", "America/New_York")).toBe(
      "2026-12-04T00:00:00.000Z",
    );
  });

  it("round-trips for datetime-local inputs", () => {
    for (const zone of ["America/Los_Angeles", "Europe/London", "UTC", "Asia/Kolkata"]) {
      const iso = zonedLocalToIso("2026-03-29T12:30", zone);
      expect(isoToZonedLocal(iso!, zone)).toBe("2026-03-29T12:30");
    }
  });

  it("rejects skipped times and picks the first of repeated ones", () => {
    // Clocks jump from 2:00 to 3:00 on March 8, 2026 in New York.
    expect(zonedLocalToIso("2026-03-08T02:30", "America/New_York")).toBeNull();
    // 1:30 happens twice on November 1, 2026: first at EDT (UTC-4).
    expect(zonedLocalToIso("2026-11-01T01:30", "America/New_York")).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });
});
