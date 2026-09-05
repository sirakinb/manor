import { describe, expect, it, vi } from "vitest";
import {
  createHttpIngestionRunner,
  FakeIngestionRunner,
  INGESTION_SIGNATURE_HEADER,
  INGESTION_TIMESTAMP_HEADER,
  IngestionRequestError,
  ingestionRunnerFromEnv,
  signIngestionRequest,
  verifyIngestionSignature,
} from "./ingestion-runner.js";

const NOW = new Date("2026-09-05T12:00:00Z");
const SECRET = "test-ingestion-secret";

describe("ingestion request signing", () => {
  it("is HMAC-SHA256 over timestamp.body and verifies in the window", () => {
    const timestamp = String(Math.floor(NOW.getTime() / 1000));
    const body = '{"runId":"r1"}';
    const signature = signIngestionRequest(SECRET, timestamp, body);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyIngestionSignature(SECRET, { timestamp, body, signature, now: NOW })).toBe(true);
  });

  it("rejects a bad secret, a changed body, garbage, and a stale timestamp", () => {
    const timestamp = String(Math.floor(NOW.getTime() / 1000));
    const body = '{"runId":"r1"}';
    const signature = signIngestionRequest(SECRET, timestamp, body);
    expect(verifyIngestionSignature("other", { timestamp, body, signature, now: NOW })).toBe(false);
    expect(
      verifyIngestionSignature(SECRET, { timestamp, body: `${body} `, signature, now: NOW }),
    ).toBe(false);
    expect(verifyIngestionSignature(SECRET, { timestamp, body, signature: "zz", now: NOW })).toBe(
      false,
    );
    expect(verifyIngestionSignature(SECRET, { timestamp: "soon", body, signature, now: NOW })).toBe(
      false,
    );
    const late = new Date(NOW.getTime() + 6 * 60_000);
    expect(verifyIngestionSignature(SECRET, { timestamp, body, signature, now: late })).toBe(false);
    const within = new Date(NOW.getTime() + 4 * 60_000);
    expect(verifyIngestionSignature(SECRET, { timestamp, body, signature, now: within })).toBe(
      true,
    );
  });
});

describe("createHttpIngestionRunner", () => {
  const request = {
    pipeline: "zoho-agent-logs",
    runId: "run-1",
    workspaceId: "ws-1",
    credentials: { "zoho-crm": { clientId: "c", clientSecret: "s", refreshToken: "r" } },
    options: { manual: false },
  };

  it("posts the signed body to /run/{pipeline} and maps the result", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, recordsLoaded: 12, notes: "2 new" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const runner = createHttpIngestionRunner({
      url: "http://ingestion:8080/",
      secret: SECRET,
      fetch: fetchImpl,
      now: () => NOW,
    });
    await expect(runner.run(request)).resolves.toEqual({
      ok: true,
      recordsLoaded: 12,
      notes: "2 new",
    });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe("http://ingestion:8080/run/zoho-agent-logs");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    const body = String(init.body);
    expect(JSON.parse(body)).toEqual({
      runId: "run-1",
      workspaceId: "ws-1",
      credentials: request.credentials,
      options: { manual: false },
    });
    expect(headers[INGESTION_TIMESTAMP_HEADER]).toBe(String(Math.floor(NOW.getTime() / 1000)));
    expect(
      verifyIngestionSignature(SECRET, {
        timestamp: headers[INGESTION_TIMESTAMP_HEADER]!,
        body,
        signature: headers[INGESTION_SIGNATURE_HEADER]!,
        now: NOW,
      }),
    ).toBe(true);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns a non-2xx into an IngestionRequestError with the sanitized message", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "pipeline busy" }), { status: 409 }),
    ) as unknown as typeof fetch;
    const runner = createHttpIngestionRunner({ url: "http://x", secret: SECRET, fetch: fetchImpl });
    const failure = await runner.run(request).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IngestionRequestError);
    expect((failure as Error).message).toBe("ingestion service responded 409: pipeline busy");
  });

  it("treats ok:false as a failed run with its error text", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, recordsLoaded: 0, error: "token expired" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const runner = createHttpIngestionRunner({ url: "http://x", secret: SECRET, fetch: fetchImpl });
    await expect(runner.run(request)).resolves.toEqual({
      ok: false,
      recordsLoaded: 0,
      error: "token expired",
    });
  });
});

describe("ingestionRunnerFromEnv", () => {
  it("is undefined without a URL and refuses a URL without a secret", () => {
    expect(ingestionRunnerFromEnv({})).toBeUndefined();
    expect(ingestionRunnerFromEnv({ INGESTION_URL: " " })).toBeUndefined();
    expect(() => ingestionRunnerFromEnv({ INGESTION_URL: "http://x" })).toThrow(/INGESTION_SECRET/);
    expect(
      ingestionRunnerFromEnv({ INGESTION_URL: "http://x", INGESTION_SECRET: "s" })?.describe().id,
    ).toBe("ingestion-http");
  });
});

describe("FakeIngestionRunner", () => {
  it("records requests and answers from its script", async () => {
    const runner = new FakeIngestionRunner();
    runner.results.set("water", { ok: false, recordsLoaded: 0, error: "no mail" });
    await expect(
      runner.run({
        ...{ pipeline: "buildium" },
        runId: "r",
        workspaceId: "w",
        credentials: {},
        options: {},
      }),
    ).resolves.toEqual({ ok: true, recordsLoaded: 0 });
    await expect(
      runner.run({ pipeline: "water", runId: "r", workspaceId: "w", credentials: {}, options: {} }),
    ).resolves.toMatchObject({ ok: false });
    expect(runner.requests.map((entry) => entry.pipeline)).toEqual(["buildium", "water"]);
  });
});
