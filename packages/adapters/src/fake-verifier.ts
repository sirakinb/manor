import type { VerificationResult, Verifier } from "@rakazo/adapter-kit";

/** Deterministic Verifier for tests. */
export class FakeVerifier implements Verifier {
  result: VerificationResult = { decision: "pass", model: "fake", latencyMs: 0 };
  requests: Parameters<Verifier["reviewAction"]>[0][] = [];

  constructor(private readonly id = "fake") {}

  describe() {
    return {
      id: this.id,
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { actions: true },
    };
  }

  async reviewAction(request: Parameters<Verifier["reviewAction"]>[0]) {
    this.requests.push(request);
    return this.result;
  }
}
