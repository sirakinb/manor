import { autoReviewTimeoutMs } from "./auto-review.js";
import { JevVerifier } from "./jev-verifier.js";

export const LLM_ENGINE = "llm";
export const JEV_ENGINE = "jev";
export type VerificationEngineId = typeof LLM_ENGINE | typeof JEV_ENGINE;

export const VERIFICATION_ENGINE_LABELS: Record<VerificationEngineId, string> = {
  [LLM_ENGINE]: "Auto-check",
  [JEV_ENGINE]: "Jev",
};

export function isVerificationEngineId(value: unknown): value is VerificationEngineId {
  return value === LLM_ENGINE || value === JEV_ENGINE;
}

/** Jev is optional: it exists only when the deployment configures a TypeSafe key. */
export function jevVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): JevVerifier | null {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) return null;
  const minConfidence = Number(env.RAKAZO_JEV_MIN_CONFIDENCE);
  return new JevVerifier({
    apiKey,
    baseUrl: env.TYPESAFE_BASE_URL?.trim() || undefined,
    model: env.TYPESAFE_MODEL?.trim() || undefined,
    minConfidence:
      Number.isFinite(minConfidence) && minConfidence >= 0 && minConfidence <= 1
        ? minConfidence
        : undefined,
    timeoutMs: autoReviewTimeoutMs(env),
  });
}

/**
 * The selected engine decides; with compare on, the other available engine also runs and is
 * logged without affecting the outcome. Falls back when the selected engine is unavailable.
 */
export function planVerificationEngines(input: {
  selected: VerificationEngineId;
  compare: boolean;
  available: Record<VerificationEngineId, boolean>;
}): { primary?: VerificationEngineId; shadow?: VerificationEngineId } {
  const other = input.selected === LLM_ENGINE ? JEV_ENGINE : LLM_ENGINE;
  if (input.available[input.selected]) {
    return {
      primary: input.selected,
      shadow: input.compare && input.available[other] ? other : undefined,
    };
  }
  return input.available[other] ? { primary: other } : {};
}
