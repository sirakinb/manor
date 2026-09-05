import { describe, expect, it, vi } from "vitest";
import {
  BUILDIUM_API,
  BuildiumLedgerError,
  buildBuildiumChargePayload,
  createBuildiumLedger,
  FakePropertyLedger,
  parseBuildiumCredential,
} from "./buildium-ledger.js";

const charge = {
  date: "2026-09-05",
  memo: "September 2026 water",
  amount: 50.25,
  accountId: 52199,
  description: "Water bill",
};

describe("buildBuildiumChargePayload", () => {
  it("matches the shape the old sync posted", () => {
    expect(buildBuildiumChargePayload(charge)).toEqual({
      Date: "2026-09-05",
      Memo: "September 2026 water",
      Lines: [{ GLAccountId: 52199, Amount: 50.25, Description: "Water bill" }],
    });
  });
});

describe("parseBuildiumCredential", () => {
  it("requires both halves of the client credential", () => {
    expect(parseBuildiumCredential({ clientId: " id ", clientSecret: "s" })).toEqual({
      clientId: "id",
      clientSecret: "s",
    });
    expect(() => parseBuildiumCredential({ clientId: "id" })).toThrow(/clientSecret/);
  });
});

describe("createBuildiumLedger", () => {
  it("posts to the lease's charges endpoint with the client headers and returns the id", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ Id: 4242 }), { status: 201 }),
    ) as unknown as typeof fetch;
    const ledger = createBuildiumLedger(
      { clientId: "cid", clientSecret: "sec" },
      { fetch: fetchImpl },
    );

    await expect(ledger.postCharge(777, charge)).resolves.toEqual({ externalId: 4242 });

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe(`${BUILDIUM_API}/leases/777/charges`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "x-buildium-client-id": "cid",
      "x-buildium-client-secret": "sec",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual(buildBuildiumChargePayload(charge));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces the status and a truncated body on failure", async () => {
    const body = "x".repeat(500);
    const fetchImpl = vi.fn(
      async () => new Response(body, { status: 422 }),
    ) as unknown as typeof fetch;
    const ledger = createBuildiumLedger(
      { clientId: "cid", clientSecret: "sec" },
      { fetch: fetchImpl },
    );
    const failure = await ledger.postCharge(1, charge).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BuildiumLedgerError);
    expect((failure as Error).message).toBe(`422 ${"x".repeat(300)}`);
  });

  it("tolerates a non-JSON success body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("ok", { status: 200 }),
    ) as unknown as typeof fetch;
    const ledger = createBuildiumLedger(
      { clientId: "cid", clientSecret: "sec" },
      { fetch: fetchImpl },
    );
    await expect(ledger.postCharge(1, charge)).resolves.toEqual({ externalId: null });
  });
});

describe("FakePropertyLedger", () => {
  it("records charges and fails only for the leases told to", async () => {
    const ledger = new FakePropertyLedger();
    ledger.failLeaseIds.add(2);
    await expect(ledger.postCharge(1, charge)).resolves.toEqual({ externalId: 9001 });
    await expect(ledger.postCharge(2, charge)).rejects.toBeInstanceOf(BuildiumLedgerError);
    expect(ledger.charges.map((entry) => entry.leaseId)).toEqual([1]);
  });
});
