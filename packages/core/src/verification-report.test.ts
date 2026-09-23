import { describe, expect, it } from "vitest";
import {
  summarizeVerification,
  userAnswerFor,
  type VerificationCheckInput,
  verificationReportCsv,
  verificationReportMarkdown,
} from "./verification-report.js";

function check(overrides: Partial<VerificationCheckInput>): VerificationCheckInput {
  return {
    createdAt: "2026-09-20T10:00:00.000Z",
    checkpoint: "action",
    subject: "gmail_send_email",
    engine: "llm",
    role: "primary",
    decision: "pass",
    reason: null,
    probability: null,
    confidence: null,
    details: null,
    model: "m",
    latencyMs: 100,
    costUsd: 0.001,
    runId: "run-1",
    effectId: "effect-1",
    effectStatus: "completed",
    botId: "bot-1",
    botName: "Chief",
    threadId: "thread-1",
    task: "Reply to the landlord",
    ...overrides,
  };
}

/** Primary LLM and shadow Jev verdicts on one action. */
function pair(
  effectId: string,
  llm: string,
  jev: string,
  effectStatus: string,
  extra: Partial<VerificationCheckInput> = {},
) {
  return [
    check({ effectId, decision: llm, effectStatus, ...extra }),
    check({
      effectId,
      engine: "jev",
      role: "shadow",
      decision: jev,
      effectStatus,
      latencyMs: 20,
      costUsd: 0.00001,
      probability: 0.8,
      confidence: 0.7,
      ...extra,
    }),
  ];
}

describe("userAnswerFor", () => {
  it("only reads an answer when the deciding engine put up an approval card", () => {
    expect(userAnswerFor(pair("e", "ask", "pass", "denied"))).toBe("denied");
    expect(userAnswerFor(pair("e", "error", "pass", "completed"))).toBe("allowed");
    expect(userAnswerFor(pair("e", "ask", "pass", "intended"))).toBeNull();
    // Ran without asking: completing is not an answer.
    expect(userAnswerFor(pair("e", "pass", "ask", "completed"))).toBeNull();
  });
});

describe("summarizeVerification", () => {
  const rows = [
    ...pair("e1", "ask", "ask", "denied"),
    ...pair("e2", "ask", "pass", "completed", { createdAt: "2026-09-21T09:00:00.000Z" }),
    ...pair("e3", "pass", "pass", "completed"),
    ...pair("e4", "pass", "ask", "completed", { botId: "bot-2", botName: "Books" }),
    ...pair("e5", "error", "pass", "intended"),
  ];
  const summary = summarizeVerification(rows);
  const [actions] = summary.checkpoints;

  it("scores each engine only on answered approval cards", () => {
    const llm = actions!.engines.find((e) => e.engine === "llm")!;
    const jev = actions!.engines.find((e) => e.engine === "jev")!;
    // e1 denied: both asked, both right. e2 allowed: llm asked (wrong), jev passed (right).
    expect(llm.answered).toEqual({ correct: 1, total: 2 });
    expect(jev.answered).toEqual({ correct: 2, total: 2 });
  });

  it("reports flag rate, errors, latency, and cost per engine", () => {
    expect(actions!.engines.find((e) => e.engine === "llm")).toMatchObject({
      checks: 5,
      flagged: 2,
      errors: 1,
      flagRate: 0.5,
      medianLatencyMs: 100,
    });
    expect(actions!.engines.find((e) => e.engine === "jev")!.costUsd).toBeCloseTo(0.00005);
  });

  it("counts agreement only where both engines decided, and lists disagreements newest first", () => {
    expect(actions).toMatchObject({ compared: 4, agreed: 2 });
    expect(summary.disagreements.map((d) => d.verdicts.map((v) => v.decision))).toEqual([
      ["ask", "pass"],
      ["pass", "ask"],
    ]);
    expect(summary.disagreements[0]).toMatchObject({ userAnswer: "allowed", botName: "Chief" });
    expect(summary.bots).toEqual([
      { id: "bot-2", name: "Books" },
      { id: "bot-1", name: "Chief" },
    ]);
  });

  it("buckets daily flag rate per engine", () => {
    expect(summary.daily.filter((d) => d.day === "2026-09-21")).toEqual([
      expect.objectContaining({ engine: "jev", checks: 1, flagRate: 0 }),
      expect.objectContaining({ engine: "llm", checks: 1, flagRate: 1 }),
    ]);
  });

  it("pairs reply checks by run", () => {
    const answers = summarizeVerification([
      check({ checkpoint: "answer", subject: "reply", effectId: null, decision: "ask" }),
      check({
        checkpoint: "answer",
        subject: "reply",
        effectId: null,
        engine: "jev",
        role: "shadow",
        decision: "ask",
      }),
    ]);
    expect(answers.checkpoints[0]).toMatchObject({ checkpoint: "answer", compared: 1, agreed: 1 });
    expect(answers.checkpoints[0]!.engines[0]!.answered.total).toBe(0);
  });
});

describe("reports", () => {
  const rows = [
    ...pair("e1", "ask", "pass", "denied", { reason: "Recipient not in task" }),
    check({
      checkpoint: "answer",
      subject: "reply",
      effectId: null,
      runId: "run-2",
      engine: "jev",
      decision: "ask",
      details: { claims: [{ text: "All tests passed.", supported: false, probability: 0.2 }] },
    }),
    check({
      checkpoint: "answer",
      subject: "reply",
      effectId: null,
      runId: "run-2",
      engine: "llm",
      role: "shadow",
      decision: "pass",
    }),
  ];
  const labels = { llm: "Auto-check", jev: "Jev" };

  it("writes a markdown report with metrics and both engines' reasoning", () => {
    const report = verificationReportMarkdown(summarizeVerification(rows), {
      generatedAt: "2026-09-23",
      days: 30,
      labels,
    });
    expect(report).toContain("| | Jev | Auto-check |");
    // Denied: Auto-check asked (right), Jev passed (wrong).
    expect(report).toContain("| Right when you answered | 0 of 1 | 1 of 1 |");
    expect(report).toContain("| Cost | $0.00001 | $0.001 |");
    expect(report).toContain('- **Auto-check** (decided): ask, "Recipient not in task"');
    expect(report).toContain(
      '- **Jev** (compared): pass, "Recipient not in task" (p=0.80, confidence 0.70)',
    );
    expect(report).toContain("  - unsupported (0.20): All tests passed.");
    expect(report).toContain("- You denied it");
  });

  it("writes one quoted CSV row per verdict and neutralizes formulas", () => {
    const csv = verificationReportCsv([
      ...rows,
      check({ effectId: "e9", task: '=HYPERLINK("x")', reason: 'said "hi"' }),
    ]).split("\n");
    expect(csv).toHaveLength(6);
    expect(csv[0]).toContain('"created_at","checkpoint","bot"');
    expect(csv.at(-1)).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.at(-1)).toContain('"said ""hi"""');
    expect(csv.find((line) => line.includes('"e1"') && line.includes('"jev"'))).toContain(
      '"denied"',
    );
  });
});
