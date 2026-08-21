// Injects extra OpenRouter model ids into the pi-ai catalog at boot — for
// stealth releases and day-one launches that the baked model list does not
// carry yet. Set EXTRA_OPENROUTER_MODELS to a comma-separated list of
// OpenRouter slugs, e.g. "stealth/ox-alpha,vendor/new-model".
//
// This module mutates the shared OPENROUTER_MODELS map, so it must be
// imported before anything calls builtinModels() (import it first in
// pi-models.ts and pi-runtime.ts).
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";

const models = OPENROUTER_MODELS as unknown as Record<string, unknown>;

for (const slug of (process.env.EXTRA_OPENROUTER_MODELS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)) {
  if (models[slug]) continue;
  models[slug] = {
    id: slug,
    name: slug,
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    provider: "openrouter",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_768,
    compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
  };
}
