/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * "2026-09-24T19:00" wall-clock time in `timeZone` → ISO instant. A time that happens twice when
 * clocks fall back resolves to the first occurrence; one skipped when clocks spring forward
 * returns null so the caller can ask for another time.
 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const wanted = local.slice(0, 16);
  const [date = "", time = "00:00"] = wanted.split("T");
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const dayMs = 24 * 60 * 60 * 1000;
  const offsets = new Set(
    [wall - dayMs, wall, wall + dayMs].map((instant) => zoneOffsetMs(instant, timeZone)),
  );
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => isoToZonedLocal(new Date(instant).toISOString(), timeZone) === wanted)
    .sort((a, b) => a - b);
  return matches[0] === undefined ? null : new Date(matches[0]).toISOString();
}

/** ISO instant → "2026-09-24T19:00" wall-clock time in `timeZone`, for datetime-local inputs. */
export function isoToZonedLocal(iso: string, timeZone: string): string {
  const instant = new Date(iso).getTime();
  const shifted = new Date(instant + zoneOffsetMs(instant, timeZone));
  return shifted.toISOString().slice(0, 16);
}
