import type { LedgerCharge, PropertyLedger } from "@rakazo/adapter-kit";

/**
 * Buildium as a PropertyLedger. The only place that knows Buildium's wire
 * format and headers; everything above it speaks LedgerCharge.
 */

export const BUILDIUM_API = "https://api.buildium.com/v1";
const REQUEST_TIMEOUT_MS = 45_000;
const ERROR_TEXT_MAX = 300;

export type BuildiumCredential = { clientId: string; clientSecret: string };

/** The fields a Buildium workspace credential must carry. */
export const BUILDIUM_CREDENTIAL_FIELDS = ["clientId", "clientSecret"] as const;

export function parseBuildiumCredential(fields: Record<string, string>): BuildiumCredential {
  const clientId = fields.clientId?.trim();
  const clientSecret = fields.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("The Buildium credential needs clientId and clientSecret");
  }
  return { clientId, clientSecret };
}

/** Buildium's lease charge body, exactly as the old sync posted it. */
export function buildBuildiumChargePayload(charge: LedgerCharge) {
  return {
    Date: charge.date,
    Memo: charge.memo,
    Lines: [
      { GLAccountId: charge.accountId, Amount: charge.amount, Description: charge.description },
    ],
  };
}

export class BuildiumLedgerError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`${status} ${body.slice(0, ERROR_TEXT_MAX)}`);
    this.name = "BuildiumLedgerError";
  }
}

export function createBuildiumLedger(
  credential: BuildiumCredential,
  options: { fetch?: typeof fetch; baseUrl?: string } = {},
): PropertyLedger {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? BUILDIUM_API;
  return {
    describe() {
      return {
        id: "buildium",
        contractVersion: "1",
        adapterVersion: "0.1.0",
        capabilities: { charges: true },
      };
    },
    async postCharge(leaseId, charge) {
      const response = await fetchImpl(`${baseUrl}/leases/${leaseId}/charges`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-buildium-client-id": credential.clientId,
          "x-buildium-client-secret": credential.clientSecret,
        },
        body: JSON.stringify(buildBuildiumChargePayload(charge)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) throw new BuildiumLedgerError(response.status, text);
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      const id = parsed && typeof parsed === "object" ? (parsed as { Id?: unknown }).Id : null;
      return { externalId: typeof id === "number" ? id : null };
    },
  };
}

/** Deterministic ledger for tests: records every charge, fails on demand. */
export class FakePropertyLedger implements PropertyLedger {
  readonly charges: { leaseId: number; charge: LedgerCharge }[] = [];
  private nextId = 9000;
  failWith: Error | null = null;
  /** Lease ids whose posts should fail, for partial-batch tests. */
  failLeaseIds = new Set<number>();

  describe() {
    return {
      id: "fake-ledger",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { charges: true },
    };
  }

  async postCharge(leaseId: number, charge: LedgerCharge) {
    if (this.failWith) throw this.failWith;
    if (this.failLeaseIds.has(leaseId)) throw new BuildiumLedgerError(422, "lease is closed");
    this.charges.push({ leaseId, charge });
    this.nextId += 1;
    return { externalId: this.nextId };
  }
}
