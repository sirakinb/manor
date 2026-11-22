/**
 * Pure comparison math for verifier engines. The server loads rows and calls these; the web
 * dashboard and downloadable reports render the results, so every number has one source.
 */

export type VerificationCheckInput = {
  createdAt: string;
  checkpoint: string;
  subject: string;
  engine: string;
  role: string;
  decision: string;
  reason: string | null;
  probability: number | null;
  confidence: number | null;
  details: unknown;
  model: string;
  latencyMs: number;
  costUsd: number | null;
  runId: string;
  effectId: string | null;
  /** Current status of the judged action, when there is one. */
  effectStatus: string | null;
  botId: string;
  botName: string;
  threadId: string;
  task: string;
};

export type UserAnswer = "allowed" | "denied";

export type EngineStats = {
  engine: string;
  checks: number;
  flagged: number;
  errors: number;
  /** Share of decided checks (pass or ask) that were flagged. */
  flagRate: number | null;
  medianLatencyMs: number | null;
  costUsd: number;
  /** Checks where the user answered the approval card, scored against that answer. */
  answered: { correct: number; total: number };
};

export type CheckpointSummary = {
  checkpoint: string;
  engines: EngineStats[];
  /** Checks judged by two engines that both reached a decision. */
  compared: number;
  agreed: number;
};

export type Verdict = {
  engine: string;
  role: string;
  decision: string;
  reason: string | null;
  probability: number | null;
  confidence: number | null;
  details: unknown;
  model: string;
  latencyMs: number;
};

export type ComparedCheck = {
  createdAt: string;
  checkpoint: string;
  subject: string;
  botId: string;
  botName: string;
  threadId: string;
  task: string;
  userAnswer: UserAnswer | null;
  verdicts: Verdict[];
};

export type DailyPoint = {
  day: string;
  checkpoint: string;
  engine: string;
  checks: number;
  flagRate: number | null;
  medianLatencyMs: number | null;
};

export type VerificationSummary = {
  checkpoints: CheckpointSummary[];
  daily: DailyPoint[];
  disagreements: ComparedCheck[];
  bots: Array<{ id: string; name: string }>;
};

const MAX_DISAGREEMENTS = 100;
const DECIDED = new Set(["pass", "ask"]);

/**
 * The approval card only appears when the deciding engine asked (or errored). Its answer is
 * ground truth for both engines; actions that ran without asking have no user answer.
 */
export function userAnswerFor(rows: VerificationCheckInput[]): UserAnswer | null {
  const primary = rows.find((row) => row.role === "primary");
  const status = primary?.effectStatus;
  if (!primary || primary.checkpoint !== "action" || primary.decision === "pass") return null;
  if (!status || status === "intended") return null;
  return status === "denied" ? "denied" : "allowed";
}

/** An engine was right when it asked about an action the user denied, or passed one they allowed. */
export function verdictMatchesAnswer(decision: string, answer: UserAnswer): boolean | null {
  if (!DECIDED.has(decision)) return null;
  return (decision === "ask") === (answer === "denied");
}

export function summarizeVerification(rows: VerificationCheckInput[]): VerificationSummary {
  const groups = groupChecks(rows);
  const compared = groups.map((group) => toComparedCheck(group));

  const checkpoints = [...new Set(rows.map((row) => row.checkpoint))].sort().map((checkpoint) => {
    const inCheckpoint = compared.filter((check) => check.checkpoint === checkpoint);
    const engines = [
      ...new Set(inCheckpoint.flatMap((check) => check.verdicts.map((v) => v.engine))),
    ]
      .sort()
      .map((engine) => engineStats(engine, inCheckpoint, rows));
    const pairs = inCheckpoint.filter(isDecidedPair);
    return {
      checkpoint,
      engines,
      compared: pairs.length,
      agreed: pairs.filter((check) => !isDisagreement(check)).length,
    };
  });

  return {
    checkpoints,
    daily: dailyPoints(rows),
    disagreements: compared
      .filter((check) => isDecidedPair(check) && isDisagreement(check))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_DISAGREEMENTS),
    bots: [...new Map(rows.map((row) => [row.botId, row.botName])).entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Keep whole checks that started inside the period. A check is dated by its earliest verdict,
 * so a pair straddling the boundary is either fully counted or fully left out.
 */
export function checksStartingSince(
  rows: VerificationCheckInput[],
  since: string,
): VerificationCheckInput[] {
  return groupChecks(rows)
    .filter(
      (group) =>
        group.reduce(
          (min, row) => (row.createdAt < min ? row.createdAt : min),
          group[0]!.createdAt,
        ) >= since,
    )
    .flat();
}

function groupChecks(rows: VerificationCheckInput[]): VerificationCheckInput[][] {
  const groups = new Map<string, VerificationCheckInput[]>();
  for (const row of rows) {
    const key = `${row.checkpoint}:${row.effectId ?? row.runId}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()];
}

function toComparedCheck(group: VerificationCheckInput[]): ComparedCheck {
  const first = group.find((row) => row.role === "primary") ?? group[0]!;
  return {
    createdAt: first.createdAt,
    checkpoint: first.checkpoint,
    subject: first.subject,
    botId: first.botId,
    botName: first.botName,
    threadId: first.threadId,
    task: first.task,
    userAnswer: userAnswerFor(group),
    verdicts: [...group]
      .sort((a, b) =>
        a.role === b.role ? a.engine.localeCompare(b.engine) : a.role === "primary" ? -1 : 1,
      )
      .map(
        ({
          engine,
          role,
          decision,
          reason,
          probability,
          confidence,
          details,
          model,
          latencyMs,
        }) => ({
          engine,
          role,
          decision,
          reason,
          probability,
          confidence,
          details,
          model,
          latencyMs,
        }),
      ),
  };
}

function isDecidedPair(check: ComparedCheck): boolean {
  return (
    new Set(check.verdicts.map((v) => v.engine)).size > 1 &&
    check.verdicts.every((v) => DECIDED.has(v.decision))
  );
}

function isDisagreement(check: ComparedCheck): boolean {
  return new Set(check.verdicts.map((v) => v.decision)).size > 1;
}

function engineStats(
  engine: string,
  checks: ComparedCheck[],
  rows: VerificationCheckInput[],
): EngineStats {
  const verdicts = checks.flatMap((check) =>
    check.verdicts.filter((v) => v.engine === engine).map((verdict) => ({ verdict, check })),
  );
  const decided = verdicts.filter(({ verdict }) => DECIDED.has(verdict.decision));
  const flagged = decided.filter(({ verdict }) => verdict.decision === "ask").length;
  const scored = verdicts.flatMap(({ verdict, check }) =>
    check.userAnswer ? [verdictMatchesAnswer(verdict.decision, check.userAnswer)] : [],
  );
  const checkpoint = checks[0]?.checkpoint;
  return {
    engine,
    checks: verdicts.length,
    flagged,
    errors: verdicts.length - decided.length,
    flagRate: decided.length ? flagged / decided.length : null,
    medianLatencyMs: median(verdicts.map(({ verdict }) => verdict.latencyMs)),
    costUsd: rows
      .filter((row) => row.engine === engine && row.checkpoint === checkpoint)
      .reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    answered: {
      correct: scored.filter((result) => result === true).length,
      total: scored.filter((result) => result !== null).length,
    },
  };
}

function dailyPoints(rows: VerificationCheckInput[]): DailyPoint[] {
  const buckets = new Map<string, VerificationCheckInput[]>();
  for (const row of rows) {
    const key = [row.createdAt.slice(0, 10), row.checkpoint, row.engine].join("|");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const [day, checkpoint, engine] = key.split("|") as [string, string, string];
      const decided = bucket.filter((row) => DECIDED.has(row.decision));
      return {
        day,
        checkpoint,
        engine,
        checks: bucket.length,
        flagRate: decided.length
          ? decided.filter((row) => row.decision === "ask").length / decided.length
          : null,
        medianLatencyMs: median(bucket.map((row) => row.latencyMs)),
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.engine.localeCompare(b.engine));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

// ---------------------------------------------------------------------------------------------
// Downloadable reports

export type ReportContext = {
  generatedAt: string;
  days: number;
  botName?: string;
  labels: Record<string, string>;
  /** The window held more checks than were loaded; only the most recent are covered. */
  truncated?: boolean;
};

const CHECKPOINT_TITLES: Record<string, string> = {
  action: "Flagged actions",
  answer: "Reply checks",
};

export function verificationReportMarkdown(
  summary: VerificationSummary,
  context: ReportContext,
): string {
  const label = (engine: string) => context.labels[engine] ?? engine;
  const lines = [
    "# Checker comparison",
    "",
    `Generated ${context.generatedAt} · last ${context.days} days · ${context.botName ?? "all bots"}`,
    "",
    ...(context.truncated
      ? ["Covers only the most recent checks in this period. Narrow the range for full data.", ""]
      : []),
  ];
  if (!summary.checkpoints.length) {
    lines.push("No checks were logged in this period.", "");
    return lines.join("\n");
  }
  for (const checkpoint of summary.checkpoints) {
    const engines = checkpoint.engines;
    lines.push(`## ${CHECKPOINT_TITLES[checkpoint.checkpoint] ?? checkpoint.checkpoint}`, "");
    lines.push(`| | ${engines.map((e) => label(e.engine)).join(" | ")} |`);
    lines.push(`|---|${engines.map(() => "---").join("|")}|`);
    const row = (name: string, value: (stats: EngineStats) => string) =>
      lines.push(`| ${name} | ${engines.map(value).join(" | ")} |`);
    row("Checks", (e) => String(e.checks));
    row("Flagged", (e) => (e.flagRate === null ? "-" : `${e.flagged} (${percent(e.flagRate)})`));
    row("Errors", (e) => String(e.errors));
    if (checkpoint.checkpoint === "action") {
      row("Right when you answered", (e) =>
        e.answered.total ? `${e.answered.correct} of ${e.answered.total}` : "-",
      );
    }
    row("Median latency", (e) => (e.medianLatencyMs === null ? "-" : `${e.medianLatencyMs} ms`));
    row("Cost", (e) => formatUsd(e.costUsd));
    lines.push(
      "",
      checkpoint.compared
        ? `Agreed on ${checkpoint.agreed} of ${checkpoint.compared} checks both engines decided (${percent(checkpoint.agreed / checkpoint.compared)}).`
        : "No checks were judged by both engines. Turn on Compare checkers to collect side-by-side data.",
      "",
    );
  }
  if (summary.checkpoints.some((c) => c.checkpoint === "action")) {
    lines.push(
      "Correctness only counts actions you answered on an approval card. Actions that ran without asking have no answer to score.",
      "",
    );
  }

  lines.push("## Disagreements", "");
  if (!summary.disagreements.length) lines.push("None in this period.", "");
  for (const check of summary.disagreements) {
    lines.push(
      `### ${check.createdAt.slice(0, 16).replace("T", " ")} · ${escapeMarkdown(check.botName)} · ${escapeMarkdown(check.subject)}`,
      "",
      `- Checkpoint: ${CHECKPOINT_TITLES[check.checkpoint] ?? check.checkpoint}`,
      `- Request: ${escapeMarkdown(truncate(check.task, 300))}`,
      ...(check.userAnswer ? [`- You ${check.userAnswer} it`] : []),
    );
    for (const verdict of check.verdicts) {
      lines.push(
        `- **${label(verdict.engine)}** (${verdict.role === "primary" ? "decided" : "compared"}): ${verdict.decision}${verdict.reason ? `, "${escapeMarkdown(verdict.reason)}"` : ""}${evidence(verdict)}`,
      );
      for (const claim of claimsOf(verdict)) {
        lines.push(
          `  - ${claim.supported ? "supported" : "unsupported"}${claim.probability === undefined ? "" : ` (${claim.probability.toFixed(2)})`}: ${escapeMarkdown(claim.text)}`,
        );
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

const CSV_COLUMNS = [
  "created_at",
  "checkpoint",
  "bot",
  "subject",
  "engine",
  "role",
  "decision",
  "reason",
  "probability",
  "confidence",
  "user_answer",
  "model",
  "latency_ms",
  "cost_usd",
  "run_id",
  "effect_id",
  "request",
] as const;

export function verificationReportCsv(rows: VerificationCheckInput[]): string {
  const answers = new Map<VerificationCheckInput, UserAnswer | null>();
  for (const group of groupChecks(rows)) {
    const answer = userAnswerFor(group);
    for (const row of group) answers.set(row, answer);
  }
  const answerFor = (row: VerificationCheckInput) => answers.get(row) ?? null;
  const records = [...rows]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => [
      row.createdAt,
      row.checkpoint,
      row.botName,
      row.subject,
      row.engine,
      row.role,
      row.decision,
      row.reason ?? "",
      row.probability ?? "",
      row.confidence ?? "",
      answerFor(row) ?? "",
      row.model,
      row.latencyMs,
      row.costUsd ?? "",
      row.runId,
      row.effectId ?? "",
      row.task,
    ]);
  return [CSV_COLUMNS, ...records].map((record) => record.map(csvCell).join(",")).join("\n");
}

/** Quote every cell and neutralize spreadsheet formulas in untrusted text. */
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value === "string" ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function evidence(verdict: Verdict): string {
  const parts = [
    verdict.probability === null ? null : `p=${verdict.probability.toFixed(2)}`,
    verdict.confidence === null ? null : `confidence ${verdict.confidence.toFixed(2)}`,
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function claimsOf(
  verdict: Verdict,
): Array<{ text: string; supported: boolean; probability?: number }> {
  const claims = (verdict.details as { claims?: unknown } | null)?.claims;
  return Array.isArray(claims) ? claims : [];
}

/** Keeps sub-cent checker costs visible instead of rounding them to zero. */
export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  return value < 0.01 ? `$${Number(value.toPrecision(2))}` : `$${value.toFixed(2)}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\s+/g, " ").replace(/([\\`*_[\]|<>#])/g, "\\$1");
}
