import { clampThinkingLevel } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { modelAcceptsImageInput } from "./model-vision.js";
import { listPiCatalog } from "./pi-models.js";
import { modelsForRequest } from "./pi-runtime.js";

const requestedModels = [
  ["anthropic", "claude-fable-5-1", "Claude Fable 5.1", "anthropic-messages"],
  ["openai-codex", "gpt-6-astra", "GPT-6 Astra", "openai-codex-responses"],
  ["openrouter", "anthropic/claude-fable-5.1", "Anthropic: Claude Fable 5.1", "openai-completions"],
  ["openrouter", "openai/gpt-6-astra", "OpenAI: GPT-6 Astra", "openai-completions"],
  [
    "openrouter",
    "deepseek/deepseek-v4.1-flash",
    "DeepSeek: DeepSeek V4.1 Flash",
    "openai-completions",
  ],
] as const;

describe("recent model availability", () => {
  it.each(requestedModels)(
    "makes %s / %s selectable and resolves its runtime transport and vision support",
    (provider, id, label, api) => {
      const entries = listPiCatalog().filter(
        (entry) => entry.provider === provider && entry.id === id,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ label, reasoning: true });
      expect(entries[0]?.thinkingLevels).toContain("high");
      const models = modelsForRequest({ model: { provider, id } }, provider);
      expect(models.getModel(provider, id)).toMatchObject({
        provider,
        id,
        api,
        reasoning: true,
        input: ["text", "image"],
      });
      expect(modelAcceptsImageInput(provider, id)).toBe(true);
    },
  );

  it.each([
    ["anthropic", "claude-fable-5-1", "auth-url"],
    ["openai-codex", "gpt-6-astra", "device-code"],
  ] as const)(
    "offers %s / %s through existing subscription credentials",
    async (provider, id, signIn) => {
      expect(
        listPiCatalog().find((entry) => entry.provider === provider && entry.id === id),
      ).toMatchObject({
        subscription: true,
        signIn,
      });
      const models = modelsForRequest(
        {
          model: {
            provider,
            id,
            oauth: {
              credential: {
                type: "oauth",
                access: "fake-access-token",
                refresh: "fake-refresh-token",
                expires: 4_000_000_000_000,
              },
            },
          },
        },
        provider,
      );
      expect(models.getModel(provider, id)?.id).toBe(id);
      expect((await models.getAvailable(provider)).some((model) => model.id === id)).toBe(true);
    },
  );

  it("uses supported DeepSeek reasoning effort and preserves tool-loop reasoning", () => {
    const provider = "openrouter";
    const id = "deepseek/deepseek-v4.1-flash";
    const model = modelsForRequest({ model: { provider, id } }, provider).getModel(provider, id);
    expect(model).toBeDefined();
    expect(clampThinkingLevel(model!, "medium")).toBe("high");
    expect(
      listPiCatalog().find((entry) => entry.provider === provider && entry.id === id)
        ?.thinkingLevels,
    ).toEqual(["off", "high", "xhigh"]);
    expect(model?.compat).toMatchObject({
      thinkingFormat: "openrouter",
      requiresReasoningContentOnAssistantMessages: true,
      supportsDeveloperRole: false,
    });
  });

  it("keeps subscription Astra's smaller context limit", () => {
    const models = modelsForRequest(
      { model: { provider: "openrouter", id: "openai/gpt-6-astra" } },
      "openrouter",
    );
    expect(models.getModel("openai-codex", "gpt-6-astra")?.contextWindow).toBe(272_000);
    expect(models.getModel("openrouter", "openai/gpt-6-astra")?.contextWindow).toBe(1_050_000);
  });

  it("preserves model definitions supplied by a newer Pi catalog", async () => {
    vi.resetModules();
    const { ANTHROPIC_MODELS } = await import("@earendil-works/pi-ai/providers/anthropic.models");
    const { OPENAI_CODEX_MODELS } = await import(
      "@earendil-works/pi-ai/providers/openai-codex.models"
    );
    const { OPENROUTER_MODELS } = await import("@earendil-works/pi-ai/providers/openrouter.models");
    const catalogs: Record<string, Record<string, unknown>> = {
      anthropic: ANTHROPIC_MODELS,
      "openai-codex": OPENAI_CODEX_MODELS,
      openrouter: OPENROUTER_MODELS,
    };
    const upstream = { name: "Upstream definition" };
    for (const [provider, id] of requestedModels) catalogs[provider]![id] = upstream;
    await import("./recent-pi-models.js");
    for (const [provider, id] of requestedModels) expect(catalogs[provider]![id]).toBe(upstream);
    vi.resetModules();
  });
});
