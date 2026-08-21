import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("extra openrouter models", () => {
  it("injects slugs from EXTRA_OPENROUTER_MODELS into the catalog", async () => {
    vi.stubEnv("EXTRA_OPENROUTER_MODELS", "stealth/test-alpha, vendor/new-model");
    vi.resetModules();
    await import("./extra-openrouter-models.js");
    const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
    const models = builtinModels();
    expect(models.getModel("openrouter", "stealth/test-alpha")?.id).toBe("stealth/test-alpha");
    expect(models.getModel("openrouter", "vendor/new-model")?.id).toBe("vendor/new-model");
  });

  it("does nothing when the variable is unset", async () => {
    vi.stubEnv("EXTRA_OPENROUTER_MODELS", "");
    vi.resetModules();
    await import("./extra-openrouter-models.js");
    const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
    expect(builtinModels().getModel("openrouter", "stealth/unset-check")).toBeUndefined();
  });

  it("does not clobber a model the catalog already has", async () => {
    const { builtinModels: before } = await import("@earendil-works/pi-ai/providers/all");
    const existing = before().getProvider("openrouter")?.getModels()[0];
    if (!existing) throw new Error("catalog empty");
    vi.stubEnv("EXTRA_OPENROUTER_MODELS", existing.id);
    vi.resetModules();
    await import("./extra-openrouter-models.js");
    const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
    const model = builtinModels().getModel("openrouter", existing.id);
    expect(model?.name).toBe(existing.name);
  });
});
