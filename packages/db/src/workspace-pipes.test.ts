import { describe, expect, it } from "vitest";
import {
  computePipeStatus,
  matchSource,
  pipeFromFreshness,
  pipeFromRuns,
  pipesForChannels,
  teamFromPipes,
  WORKSPACE_PIPES,
  workerStatus,
} from "./workspace-pipes.js";

const NOW = new Date("2026-09-04T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
const spec = (key: string) => WORKSPACE_PIPES.find((pipe) => pipe.key === key)!;

describe("pipesForChannels", () => {
  it("gives a workspace the pipes of its channels and nothing else", () => {
    expect(pipesForChannels(["voice", "utilities"]).map((pipe) => pipe.key)).toEqual([
      "voice",
      "water",
      "recap",
    ]);
    expect(pipesForChannels([])).toEqual([]);
    expect(pipesForChannels(["seo"])).toEqual([]);
  });

  it("covers every channel with the full registry", () => {
    const all = pipesForChannels(["voice", "email", "social", "leasing", "utilities"]);
    expect(all.map((pipe) => pipe.key)).toEqual([
      "email-recap",
      "voice",
      "email",
      "instagram",
      "buildium",
      "listings",
      "water",
      "recap",
    ]);
  });
});

describe("matchSource", () => {
  const sources = [
    { id: "s1", name: "Zoho Campaigns" },
    { id: "s2", name: "zoho" },
    { id: "s3", name: "Instagram" },
    { id: "s4", name: "buildium" },
  ];

  it("matches the registered Jackson rows case-insensitively on the full name", () => {
    expect(matchSource(spec("email"), sources)?.id).toBe("s1");
    expect(matchSource(spec("voice"), sources)?.id).toBe("s2");
    expect(matchSource(spec("instagram"), sources)?.id).toBe("s3");
    expect(matchSource(spec("buildium"), sources)?.id).toBe("s4");
    expect(matchSource(spec("water"), sources)).toBeNull();
  });

  it("never binds the internal recap pipe to a source", () => {
    expect(spec("recap").internal).toBe(true);
    expect(matchSource(spec("recap"), [{ id: "x", name: "Voice rollup" }])).toBeNull();
    expect(WORKSPACE_PIPES.filter((pipe) => pipe.internal).map((pipe) => pipe.key)).toEqual([
      "email-recap",
      "recap",
    ]);
  });
});

describe("computePipeStatus", () => {
  it("is idle with no signal, flowing when fresh, overdue past the threshold", () => {
    const voice = spec("voice");
    expect(computePipeStatus(voice, null, false, NOW)).toBe("idle");
    expect(computePipeStatus(voice, hoursAgo(1), false, NOW)).toBe("flowing");
    expect(computePipeStatus(voice, hoursAgo(72), false, NOW)).toBe("flowing");
    expect(computePipeStatus(voice, hoursAgo(72.5), false, NOW)).toBe("overdue");
  });

  it("reports failing ahead of every other signal", () => {
    expect(computePipeStatus(spec("email"), hoursAgo(1), true, NOW)).toBe("failing");
    expect(computePipeStatus(spec("email"), null, true, NOW)).toBe("failing");
  });
});

describe("pipeFromRuns", () => {
  const runs = [
    {
      status: "error",
      startedAt: hoursAgo(2).toISOString(),
      finishedAt: hoursAgo(1.9).toISOString(),
      recordsLoaded: 0,
      errorMessage: "token expired",
    },
    {
      status: "success",
      startedAt: hoursAgo(26).toISOString(),
      finishedAt: hoursAgo(25.9).toISOString(),
      recordsLoaded: 12,
      errorMessage: null,
    },
  ];

  it("judges by the newest run and surfaces its error", () => {
    const pipe = pipeFromRuns(
      spec("email"),
      { sourceId: "src-email", automationKey: "email" },
      runs,
      NOW,
    );
    expect(pipe).toMatchObject({
      key: "email",
      channel: "email",
      sourceId: "src-email",
      automationKey: "email",
      internal: false,
      status: "failing",
      lastAt: hoursAgo(2).toISOString(),
      ageHours: 2,
      lastRecords: 0,
      lastError: "token expired",
    });
    expect(pipe.runs).toHaveLength(2);
  });

  it("is idle with no runs at all", () => {
    expect(
      pipeFromRuns(spec("email"), { sourceId: null, automationKey: null }, [], NOW),
    ).toMatchObject({
      sourceId: null,
      status: "idle",
      lastAt: null,
      ageHours: null,
      lastRecords: null,
      lastError: null,
      runs: [],
    });
  });

  it("hides the error message once a later run succeeds", () => {
    const pipe = pipeFromRuns(
      spec("email"),
      { sourceId: "src-email", automationKey: null },
      [runs[1]!, runs[0]!],
      NOW,
    );
    expect(pipe.status).toBe("flowing");
    expect(pipe.lastError).toBeNull();
    expect(pipe.lastRecords).toBe(12);
  });
});

describe("pipeFromFreshness", () => {
  it("never reports failing and carries no runs", () => {
    expect(
      pipeFromFreshness(
        spec("water"),
        { sourceId: null, automationKey: null },
        hoursAgo(24 * 20),
        NOW,
      ),
    ).toMatchObject({
      status: "overdue",
      ageHours: 480,
      lastRecords: null,
      lastError: null,
      runs: [],
    });
    expect(
      pipeFromFreshness(spec("water"), { sourceId: null, automationKey: null }, null, NOW).status,
    ).toBe("idle");
  });
});

describe("workerStatus", () => {
  it("rolls pipe states up into client-safe words", () => {
    expect(workerStatus([{ status: "idle" }], null, NOW)).toBe("setting_up");
    expect(workerStatus([{ status: "idle" }, { status: "overdue" }], hoursAgo(5), NOW)).toBe(
      "catching_up",
    );
    expect(workerStatus([{ status: "failing" }], hoursAgo(0.1), NOW)).toBe("catching_up");
    expect(workerStatus([{ status: "flowing" }], hoursAgo(0.5), NOW)).toBe("working");
    expect(workerStatus([{ status: "flowing" }], hoursAgo(3), NOW)).toBe("fresh");
    expect(workerStatus([], null, NOW)).toBe("setting_up");
  });
});

describe("teamFromPipes", () => {
  it("lists one worker per channel present, with the newest pipe timestamp", () => {
    const pipes = [
      pipeFromFreshness(
        spec("voice"),
        { sourceId: "src-zoho", automationKey: "voice" },
        hoursAgo(0.5),
        NOW,
      ),
      pipeFromFreshness(
        spec("recap"),
        { sourceId: null, automationKey: null },
        hoursAgo(24 * 10),
        NOW,
      ),
      pipeFromFreshness(spec("water"), { sourceId: null, automationKey: null }, null, NOW),
    ];
    const team = teamFromPipes(pipes, NOW);
    expect(team.map((worker) => worker.key)).toEqual(["call-logger", "water-clerk"]);
    expect(team[0]).toMatchObject({
      name: "Call logger",
      channel: "voice",
      status: "working",
      lastAt: hoursAgo(0.5).toISOString(),
      cadence: "every 10 min",
    });
    expect(team[1]).toMatchObject({
      name: "Water-bill clerk",
      channel: "utilities",
      status: "setting_up",
      lastAt: null,
      cadence: "weekly + month-end",
    });
  });

  it("is empty for a workspace without channels", () => {
    expect(teamFromPipes([], NOW)).toEqual([]);
  });
});
