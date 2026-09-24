import { clampThinkingLevel } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import { describe, expect, it, vi } from "vitest";
import { modelAcceptsImageInput } from "./model-vision.js";
import { listPiCatalog } from "./pi-models.js";
import { modelsForRequest } from "./pi-runtime.js";

const requestedModels = [
  ["anthropic", "claude-fable-5-1", "Claude Fable 5.1", "anthropic-messages"],
  ["anthropic", "claude-opus-5-5", "Claude Opus 5.5", "anthropic-messages"],
  ["openai-codex", "gpt-6-astra", "GPT-6 Astra", "openai-codex-responses"],
  ["openai-codex", "gpt-6-sol", "GPT-6 Sol", "openai-codex-responses"],
  ["openai-codex", "gpt-6-luna", "GPT-6 Luna", "openai-codex-responses"],
  ["openrouter", "anthropic/claude-fable-5.1", "Anthropic: Claude Fable 5.1", "openai-completions"],
  ["openrouter", "anthropic/claude-opus-5.5", "Anthropic: Claude Opus 5.5", "openai-completions"],
  ["openrouter", "openai/gpt-6-astra", "OpenAI: GPT-6 Astra", "openai-completions"],
  ["openrouter", "openai/gpt-6-sol", "OpenAI: GPT-6 Sol", "openai-completions"],
  ["openrouter", "openai/gpt-6-luna", "OpenAI: GPT-6 Luna", "openai-completions"],
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
    ["anthropic", "claude-opus-5-5", "auth-url"],
    ["openai-codex", "gpt-6-astra", "device-code"],
    ["openai-codex", "gpt-6-sol", "device-code"],
    ["openai-codex", "gpt-6-luna", "device-code"],
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

  const effort = ["low", "medium", "high", "xhigh", "max"];
  it.each([
    ["anthropic", "claude-opus-5-5", 1_000_000, 4, effort],
    ["openrouter", "anthropic/claude-opus-5.5", 1_000_000, 4, effort],
    ["openai-codex", "gpt-6-sol", 272_000, 2, ["off", "minimal", ...effort]],
    ["openrouter", "openai/gpt-6-sol", 1_050_000, 2, ["off", ...effort]],
    ["openai-codex", "gpt-6-luna", 272_000, 0.1, ["off", "minimal", ...effort]],
    ["openrouter", "openai/gpt-6-luna", 1_050_000, 0.1, ["off", ...effort]],
  ] as const)(
    "keeps %s / %s context, pricing, and thinking levels",
    (provider, id, contextWindow, inputCost, thinkingLevels) => {
      const model = modelsForRequest({ model: { provider, id } }, provider).getModel(provider, id);
      expect(model).toMatchObject({ contextWindow, cost: { input: inputCost } });
      expect(
        listPiCatalog().find((entry) => entry.provider === provider && entry.id === id)
          ?.thinkingLevels,
      ).toEqual(thinkingLevels);
    },
  );

  it("identifies Opus 5.5 subscription requests as a Claude Code version Anthropic accepts", () => {
    const models = modelsForRequest(
      { model: { provider: "anthropic", id: "claude-opus-5-5" } },
      "anthropic",
    );
    expect(models.getModel("anthropic", "claude-opus-5-5")?.headers).toEqual({
      "user-agent": "claude-cli/2.1.280",
    });
    expect(models.getModel("anthropic", "claude-sonnet-5")?.headers).toMatchObject({
      "user-agent": "claude-cli/2.1.280",
    });
    expect(models.getModel("openrouter", "anthropic/claude-opus-5.5")?.headers).toBeUndefined();
  });

  it("sends an accepted Claude Code version on Anthropic subscription requests", async () => {
    const userAgents = new Map<string, string | null>();
    const intercept = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      userAgents.set(String(JSON.parse(String(init?.body)).model), headers.get("user-agent"));
      return Response.json(
        { type: "error", error: { type: "probe", message: "stop" } },
        { status: 400 },
      );
    });
    vi.stubGlobal("fetch", intercept);
    try {
      for (const id of ["claude-opus-5-5", "claude-fable-5-1"]) {
        const model = modelsForRequest(
          { model: { provider: "anthropic", id } },
          "anthropic",
        ).getModel("anthropic", id)!;
        await complete(
          model,
          { messages: [{ role: "user", content: "hi", timestamp: 0 }] },
          { apiKey: "sk-ant-oat01-fake-subscription-token" },
        ).catch(() => undefined);
      }
    } finally {
      vi.unstubAllGlobals();
    }
    // Every Anthropic model reports a Claude Code version its subscription gate accepts.
    expect(userAgents.get("claude-opus-5-5")).toBe("claude-cli/2.1.280");
    expect(userAgents.get("claude-fable-5-1")).toBe("claude-cli/2.1.280");
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
