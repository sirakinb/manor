import { type RunFailureDiagnostic, RunFailureDiagnosticSchema } from "@rakazo/contracts";

/** Only categorical metadata crosses the diagnostics boundary; never error causes or URLs. */
export function diagnoseRunFailure(
  error: unknown,
  stage: RunFailureDiagnostic["stage"] = "unknown",
): RunFailureDiagnostic {
  if (error instanceof RunExecutionError) return error.diagnostic;
  const seen = new Set<unknown>();
  let current = error;
  let text = "";
  let code: RunFailureDiagnostic["code"] = null;
  for (let depth = 0; current && depth < 6 && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current === "string") {
      text += ` ${current.slice(0, 4000)}`;
      break;
    }
    if (!(current instanceof Error)) break;
    text += ` ${current.message.slice(0, 4000)}`;
    const candidate = RunFailureDiagnosticSchema.shape.code.safeParse(
      (current as Error & { code?: unknown }).code,
    );
    if (candidate.success && candidate.data) code ??= candidate.data;
    current = current.cause;
  }
  if (!code) {
    const match = text.match(
      /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_SOCKET)\b/,
    );
    if (match) code = RunFailureDiagnosticSchema.shape.code.parse(match[1]);
  }
  const category = /timeout|timed out|ETIMEDOUT/i.test(`${code ?? ""} ${text}`)
    ? "timeout"
    : code ||
        /fetch failed|network error|socket hang up|connection reset|connection failed/i.test(text)
      ? "network"
      : /\b429\b|rate.limit/i.test(text)
        ? "rate_limit"
        : /\b401\b|unauthorized|invalid.api.key|token.expired/i.test(text)
          ? "authentication"
          : "unknown";
  return { stage, category, code };
}

export class RunExecutionError extends Error {
  constructor(
    message: string,
    readonly diagnostic: RunFailureDiagnostic,
  ) {
    super(message);
    this.name = "RunExecutionError";
  }
}

export function runFailureSummary(failure: RunFailureDiagnostic): string {
  const source =
    failure.stage === "model"
      ? "Model request"
      : failure.stage === "tool"
        ? "Tool execution"
        : "Run";
  const reason = {
    network: "connection failed",
    timeout: "timed out",
    rate_limit: "was rate limited",
    authentication: "authentication failed",
    unknown: "failed; use the run ID to inspect service logs",
  }[failure.category];
  return `${source} ${reason}${failure.code ? ` (${failure.code})` : ""}.`;
}
