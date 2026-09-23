import type { Api, Model } from "@earendil-works/pi-ai";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";

// Backfill launches missing from the pinned Pi catalog. Keep these in the shared
// provider maps so picker, OAuth runtime, and vision checks resolve the same models.
// Upstream definitions win once Pi includes them.
// Sources: @earendil-works/pi-ai 0.85.1 (Fable/Astra), 0.87.1 (Opus 5.5, GPT-6 Sol/Luna), and
// https://pi.dev/models/openrouter/deepseek-deepseek-v4-1-flash
const fable: Model<"anthropic-messages"> = {
  id: "claude-fable-5-1",
  name: "Claude Fable 5.1",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  contextWindow: 1_000_000,
  maxTokens: 128_000,
  thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
  compat: { forceAdaptiveThinking: true, supportsStrictTools: true },
};

const opus55: Model<"anthropic-messages"> = {
  ...fable,
  id: "claude-opus-5-5",
  name: "Claude Opus 5.5",
  cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
  compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsStrictTools: true },
};

const astra: Model<"openai-codex-responses"> = {
  id: "gpt-6-astra",
  name: "GPT-6 Astra",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text", "image"],
  cost: {
    input: 10,
    output: 50,
    cacheRead: 1,
    cacheWrite: 12.5,
    tiers: [{ inputTokensAbove: 272_000, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }],
  },
  contextWindow: 272_000,
  maxTokens: 128_000,
  thinkingLevelMap: { off: null, minimal: "low", xhigh: "xhigh", max: "max" },
  compat: {
    supportsOpenAIGrammarTools: true,
    supportsAdditionalTools: true,
    supportsToolSearch: true,
  },
};

const sol: Model<"openai-codex-responses"> = {
  ...astra,
  id: "gpt-6-sol",
  name: "GPT-6 Sol",
  cost: {
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
    tiers: [{ inputTokensAbove: 272_000, input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 }],
  },
  thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
};

const luna: Model<"openai-codex-responses"> = {
  ...sol,
  id: "gpt-6-luna",
  name: "GPT-6 Luna",
  cost: {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    tiers: [
      { inputTokensAbove: 272_000, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 },
    ],
  },
};

const openrouterModels: Model<"openai-completions">[] = [
  {
    ...fable,
    id: "anthropic/claude-fable-5.1",
    name: "Anthropic: Claude Fable 5.1",
    // Use the completions transport registered by the pinned OpenRouter adapter.
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
    compat: { thinkingFormat: "openrouter", cacheControlFormat: "anthropic" },
  },
  {
    ...opus55,
    id: "anthropic/claude-opus-5.5",
    name: "Anthropic: Claude Opus 5.5",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    compat: { thinkingFormat: "openrouter", cacheControlFormat: "anthropic" },
  },
  {
    ...astra,
    id: "openai/gpt-6-astra",
    name: "OpenAI: GPT-6 Astra",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    contextWindow: 1_050_000,
    thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
    compat: { thinkingFormat: "openrouter" },
  },
  {
    ...sol,
    id: "openai/gpt-6-sol",
    name: "OpenAI: GPT-6 Sol",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    contextWindow: 1_050_000,
    thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: "max" },
    compat: { thinkingFormat: "openrouter" },
  },
  {
    ...luna,
    id: "openai/gpt-6-luna",
    name: "OpenAI: GPT-6 Luna",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    contextWindow: 1_050_000,
    thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: "max" },
    compat: { thinkingFormat: "openrouter" },
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek: DeepSeek V4.1 Flash",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 384_000,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "xhigh",
      max: null,
    },
    compat: {
      supportsDeveloperRole: false,
      thinkingFormat: "openrouter",
      sendSessionAffinityHeaders: true,
      requiresReasoningContentOnAssistantMessages: true,
    },
  },
];

const catalogs: Record<string, Record<string, Model<Api>>> = {
  anthropic: ANTHROPIC_MODELS,
  "openai-codex": OPENAI_CODEX_MODELS,
  openrouter: OPENROUTER_MODELS,
};

for (const model of [fable, opus55, astra, sol, luna, ...openrouterModels]) {
  catalogs[model.provider]![model.id] ??= model;
}
