import { describe, expect, it } from "vitest";
import {
  automationNextRunAt,
  automationSpec,
  automationStatus,
  automationsForChannels,
  WORKSPACE_AUTOMATIONS,
} from "./workspace-automations.js";
import { WORKSPACE_PIPES } from "./workspace-pipes.js";

// A Friday in EDT (UTC-4): 2026-09-04 08:30 New York = 12:30Z.
const FROM = new Date("2026-09-04T12:30:00Z");
const NY = "America/New_York";

describe("automation registry", () => {
  it("has one pipe for every automation key, and vice versa", () => {
    const pipeKeys = WORKSPACE_PIPES.map((pipe) => pipe.key).sort();
    const automationKeys = WORKSPACE_AUTOMATIONS.map((spec) => spec.key).sort();
    expect(automationKeys).toEqual(pipeKeys);
  });

  it("gives a workspace the automations of its channels only", () => {
    expect(automationsForChannels(["utilities", "voice"]).map((spec) => spec.key)).toEqual([
      "voice",
      "water",
      "recap",
    ]);
    expect(automationsForChannels([])).toEqual([]);
    expect(automationSpec("nope")).toBeUndefined();
  });

  it("names the credentials each pipeline needs", () => {
    expect(automationSpec("voice")?.credentials).toEqual(["zoho-crm"]);
    expect(automationSpec("listings")?.credentials).toEqual([]);
    expect(automationSpec("recap")?.sourceName).toBeNull();
  });
});

describe("automationNextRunAt", () => {
  it("schedules in the workspace timezone", () => {
    // 08:30 New York on the 4th: today's 09:00 New York is 13:00Z during EDT.
    expect(automationNextRunAt(["0 9 * * *"], NY, FROM)?.toISOString()).toBe(
      "2026-09-04T13:00:00.000Z",
    );
    expect(automationNextRunAt(["0 9 * * *"], "UTC", FROM)?.toISOString()).toBe(
      "2026-09-05T09:00:00.000Z",
    );
  });

  it("takes the earliest of several crons", () => {
    // Monday 08:00 (Sept 7) vs the month-end sweep 26-29 (Sept 26): Monday wins.
    expect(automationNextRunAt(["0 8 * * 1", "0 8 26-29 * *"], NY, FROM)?.toISOString()).toBe(
      "2026-09-07T12:00:00.000Z",
    );
    // From the 25th the sweep wins over the following Monday (Sept 28).
    const late = new Date("2026-09-25T12:30:00Z");
    expect(automationNextRunAt(["0 8 * * 1", "0 8 26-29 * *"], NY, late)?.toISOString()).toBe(
      "2026-09-26T12:00:00.000Z",
    );
  });

  it("rejects a malformed cron rather than saving it", () => {
    expect(() => automationNextRunAt(["every ten minutes"], NY, FROM)).toThrow(RangeError);
  });
});

describe("automationStatus", () => {
  const row = { key: "email", enabled: true, lastRunAt: null };
  const run = (status: string, hoursAgo: number) => ({
    status,
    startedAt: new Date(FROM.getTime() - hoursAgo * 3_600_000),
    finishedAt: null,
    recordsLoaded: 0,
    errorMessage: null,
  });

  it("uses the pipe threshold and the newest run's outcome", () => {
    expect(automationStatus(row, null, FROM)).toBe("idle");
    expect(automationStatus(row, run("success", 1), FROM)).toBe("flowing");
    expect(automationStatus(row, run("success", 40), FROM)).toBe("overdue");
    expect(automationStatus(row, run("error", 1), FROM)).toBe("failing");
    expect(automationStatus({ ...row, lastRunAt: new Date(FROM) }, null, FROM)).toBe("flowing");
  });
});
