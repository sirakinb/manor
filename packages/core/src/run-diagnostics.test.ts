import { describe, expect, it } from "vitest";
import { diagnoseRunFailure, RunExecutionError, runFailureSummary } from "./run-diagnostics.js";

describe("run failure diagnostics", () => {
  it("keeps a network code and stage without copying private cause text", () => {
    const error = new Error("fetch failed", {
      cause: Object.assign(
        new Error("connect failed https://private.example.test?token=fake-secret"),
        { code: "ECONNRESET" },
      ),
    });
    const diagnostic = diagnoseRunFailure(error, "model");
    expect(diagnostic).toEqual({ stage: "model", category: "network", code: "ECONNRESET" });
    expect(runFailureSummary(diagnostic)).toBe("Model request connection failed (ECONNRESET).");
    expect(JSON.stringify(diagnostic)).not.toContain("fake-secret");
  });
  it("preserves a failure's stage through runtime wrapping and bounds circular causes", () => {
    const diagnostic = diagnoseRunFailure("fetch failed", "tool");
    expect(diagnoseRunFailure(new RunExecutionError("sanitized", diagnostic), "execution")).toEqual(
      diagnostic,
    );
    const circular = new Error("timeout");
    circular.cause = circular;
    expect(diagnoseRunFailure(circular).category).toBe("timeout");
  });
  it("does not invent a stage or expose unknown errors in copied diagnostics", () => {
    const diagnostic = diagnoseRunFailure("password=fake-secret customer data");
    expect(diagnostic.stage).toBe("unknown");
    expect(runFailureSummary(diagnostic)).not.toContain("fake-secret");
    expect(diagnoseRunFailure("429 Too many requests").category).toBe("rate_limit");
  });
});
