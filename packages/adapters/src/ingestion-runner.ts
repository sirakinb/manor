import { createHmac, timingSafeEqual } from "node:crypto";
import type { IngestionRunner, IngestionRunRequest, IngestionRunResult } from "@rakazo/adapter-kit";

/**
 * HTTP client for the ingestion service (apps/ingestion). Requests are
 * signed with a shared secret so the service, which holds no credentials of
 * its own, only runs pipelines Manor asked for.
 */

export const INGESTION_SIGNATURE_HEADER = "x-manor-signature";
export const INGESTION_TIMESTAMP_HEADER = "x-manor-timestamp";
/** How far a request's timestamp may drift from the receiver's clock. */
export const INGESTION_MAX_SKEW_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const ERROR_TEXT_MAX = 300;

/** HMAC-SHA256 over `timestamp + "." + body`, hex-encoded. */
export function signIngestionRequest(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Constant-time check of a signature and its timestamp window. Mirrors the service's verifier. */
export function verifyIngestionSignature(
  secret: string,
  input: { timestamp: string; body: string; signature: string; now?: Date },
): boolean {
  const at = Number(input.timestamp);
  if (!Number.isFinite(at)) return false;
  const nowMs = (input.now ?? new Date()).getTime();
  if (Math.abs(nowMs - at * 1000) > INGESTION_MAX_SKEW_MS) return false;
  const expected = Buffer.from(signIngestionRequest(secret, input.timestamp, input.body), "hex");
  const given = Buffer.from(input.signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type IngestionRunnerOptions = {
  url: string;
  secret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
};

export class IngestionRequestError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`ingestion service responded ${status}: ${body.slice(0, ERROR_TEXT_MAX)}`);
    this.name = "IngestionRequestError";
  }
}

export function createHttpIngestionRunner(options: IngestionRunnerOptions): IngestionRunner {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.url.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  return {
    describe() {
      return {
        id: "ingestion-http",
        contractVersion: "1",
        adapterVersion: "0.1.0",
        capabilities: { pipelines: true },
      };
    },
    async run(request: IngestionRunRequest): Promise<IngestionRunResult> {
      const body = JSON.stringify({
        runId: request.runId,
        workspaceId: request.workspaceId,
        credentials: request.credentials,
        options: request.options,
      });
      const timestamp = String(Math.floor(now().getTime() / 1000));
      const response = await fetchImpl(`${baseUrl}/run/${encodeURIComponent(request.pipeline)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          [INGESTION_TIMESTAMP_HEADER]: timestamp,
          [INGESTION_SIGNATURE_HEADER]: signIngestionRequest(options.secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        const candidate: unknown = text ? JSON.parse(text) : {};
        if (candidate && typeof candidate === "object")
          parsed = candidate as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      if (!response.ok) {
        const detail = typeof parsed.error === "string" ? parsed.error : text;
        throw new IngestionRequestError(response.status, detail);
      }
      return {
        ok: parsed.ok !== false,
        recordsLoaded: typeof parsed.recordsLoaded === "number" ? parsed.recordsLoaded : 0,
        ...(typeof parsed.notes === "string" ? { notes: parsed.notes } : {}),
        ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
      };
    },
  };
}

/** The runner the deployment configured, or undefined when INGESTION_URL is unset. */
export function ingestionRunnerFromEnv(env: {
  INGESTION_URL?: string;
  INGESTION_SECRET?: string;
}): IngestionRunner | undefined {
  const url = env.INGESTION_URL?.trim();
  if (!url) return undefined;
  const secret = env.INGESTION_SECRET?.trim();
  if (!secret) throw new Error("INGESTION_SECRET is required when INGESTION_URL is set");
  return createHttpIngestionRunner({ url, secret });
}

/** Deterministic runner for tests: records requests and answers from a script. */
export class FakeIngestionRunner implements IngestionRunner {
  readonly requests: IngestionRunRequest[] = [];
  /** Per-pipeline canned results; unlisted pipelines succeed with 0 records. */
  results = new Map<string, IngestionRunResult | Error>();

  describe() {
    return {
      id: "fake-ingestion",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { pipelines: true },
    };
  }

  async run(request: IngestionRunRequest): Promise<IngestionRunResult> {
    this.requests.push(request);
    const scripted = this.results.get(request.pipeline);
    if (scripted instanceof Error) throw scripted;
    return scripted ?? { ok: true, recordsLoaded: 0 };
  }
}
