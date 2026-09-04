import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { detailedReasoningSummary, reliableStreamOptions } from "./pi-runtime.js";

describe("Pi runtime transport", () => {
  it.each([
    { source: "provider", provider: "openai-codex", api: "openai-completions" },
    { source: "API", provider: "custom-provider", api: "openai-codex-responses" },
  ])("forces SSE when Codex is identified by $source", ({ provider, api }) => {
    const model = { provider, api } as Model<Api>;

    expect(reliableStreamOptions(model, { transport: "auto", maxRetries: 4 })).toMatchObject({
      transport: "sse",
      maxRetries: 4,
    });
  });

  it("leaves other provider transports unchanged", () => {
    const model = { provider: "openrouter", api: "openai-completions" } as Model<Api>;
    const options = { transport: "auto" as const, maxRetries: 2 };

    expect(reliableStreamOptions(model, options)).toBe(options);
  });
});

describe("OpenAI reasoning summaries", () => {
  const model = { provider: "openai", api: "openai-responses" } as Model<Api>;

  it("upgrades the request's reasoning summary to detailed", async () => {
    const shaped = reliableStreamOptions(model, { maxRetries: 1 });
    const body = { model: "gpt-5", reasoning: { effort: "medium", summary: "auto" } };

    await expect(shaped?.onPayload?.(body, model)).resolves.toEqual({
      model: "gpt-5",
      reasoning: { effort: "medium", summary: "detailed" },
    });
  });

  it("leaves requests without reasoning alone", () => {
    expect(detailedReasoningSummary({ model: "gpt-4.1" })).toEqual({ model: "gpt-4.1" });
    expect(detailedReasoningSummary(undefined)).toBeUndefined();
  });

  it("runs after an existing payload hook and keeps its edits", async () => {
    const shaped = reliableStreamOptions(model, {
      onPayload: (payload) => ({ ...(payload as object), tagged: true }),
    });
    const body = { reasoning: { effort: "high", summary: "auto" } };

    await expect(shaped?.onPayload?.(body, model)).resolves.toEqual({
      tagged: true,
      reasoning: { effort: "high", summary: "detailed" },
    });
  });

  it.each(["openai-codex-responses", "azure-openai-responses"])("applies to %s too", (api) => {
    const shaped = reliableStreamOptions({ provider: "openai", api } as Model<Api>, {});
    expect(shaped?.onPayload).toBeTypeOf("function");
  });

  it("does not touch non-OpenAI APIs", () => {
    const shaped = reliableStreamOptions(
      { provider: "anthropic", api: "anthropic-messages" } as Model<Api>,
      { maxRetries: 3 },
    );
    expect(shaped?.onPayload).toBeUndefined();
  });
});
