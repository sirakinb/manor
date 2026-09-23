import type { VerificationResult, Verifier } from "@rakazo/adapter-kit";

/** Deterministic Verifier for tests. */
export class FakeVerifier implements Verifier {
  result: VerificationResult = { decision: "pass", model: "fake", latencyMs: 0 };
  requests: Parameters<Verifier["reviewAction"]>[0][] = [];
  answerRequests: Parameters<Verifier["checkAnswer"]>[0][] = [];

  constructor(private readonly id = "fake") {}

  describe() {
    return {
      id: this.id,
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { actions: true, answers: true },
    };
  }

  async reviewAction(request: Parameters<Verifier["reviewAction"]>[0]) {
    this.requests.push(request);
    return this.result;
  }

  async checkAnswer(request: Parameters<Verifier["checkAnswer"]>[0]) {
    this.answerRequests.push(request);
    return this.result;
  }
}
