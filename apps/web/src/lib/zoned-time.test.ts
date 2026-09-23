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
      expect(isoToZonedLocal(iso, zone)).toBe("2026-03-29T12:30");
    }
  });
});
