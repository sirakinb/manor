import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

// Manor adds recent models to the catalog (packages/adapters/src/recent-pi-models.ts); upstream
// dropped the rest of this spec as covered by unit tests.

test("recent models are selectable through OpenRouter and subscriptions", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const userName = `Recent models ${stamp}`;
  await signup(page, `recent-models-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page);
  // Models are picked per role from the connections a member has. Present an OpenRouter key and
  // both subscriptions as connected; the server has no such accounts, so the saved main role is
  // echoed back instead of being checked against them.
  await page.route("**/rpc/models/credentials", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            id: "cred-openrouter",
            provider: "openrouter",
            label: "OpenRouter",
            hasKey: true,
            isDefault: true,
            authKind: "api_key",
          },
          {
            id: "cred-claude",
            provider: "anthropic",
            label: "Anthropic",
            hasKey: false,
            isDefault: false,
            authKind: "oauth",
          },
          {
            id: "cred-codex",
            provider: "openai-codex",
            label: "OpenAI Codex",
            hasKey: false,
            isDefault: false,
            authKind: "oauth",
          },
        ],
      },
    }),
  );
  await page.route("**/rpc/models/setRole", async (route) => {
    const { json } = route.request().postDataJSON() as {
      json: { primary?: unknown; backups?: unknown[] };
    };
    await route.fulfill({
      json: { json: { primary: json.primary ?? null, backups: json.backups ?? [] } },
    });
  });
  await openUserSettings(page, "models");
  await expect(page.getByRole("button", { name: "Close model settings" })).toBeVisible();
  const main = page.getByTestId("model-role-main");
  await expect(main).toBeVisible();

  for (const [query, label, screenshot] of [
    ["Fable 5.1", "Anthropic: Claude Fable 5.1", "openrouter-fable-5-1"],
    ["Opus 5.5", "Anthropic: Claude Opus 5.5", "openrouter-opus-5-5"],
    ["GPT-6 Astra", "OpenAI: GPT-6 Astra", "openrouter-gpt-6-astra"],
    ["GPT-6 Sol", "OpenAI: GPT-6 Sol", "openrouter-gpt-6-sol"],
    ["GPT-6 Luna", "OpenAI: GPT-6 Luna", "openrouter-gpt-6-luna"],
    ["V4.1 Flash", "DeepSeek: DeepSeek V4.1 Flash", "openrouter-deepseek-v4-1-flash"],
    ["Fable 5.1", "Claude Fable 5.1", "subscription-fable-5-1"],
    ["Opus 5.5", "Claude Opus 5.5", "subscription-opus-5-5"],
    ["GPT-6 Astra", "GPT-6 Astra", "subscription-gpt-6-astra"],
    ["GPT-6 Sol", "GPT-6 Sol", "subscription-gpt-6-sol"],
    ["GPT-6 Luna", "GPT-6 Luna", "subscription-gpt-6-luna"],
  ]) {
    await main
      .getByRole("button", { name: /^Change / })
      .first()
      .click();
    await page.getByRole("combobox", { name: "Search models" }).fill(query!);
    const option = page.getByRole("listbox", { name: "Model options" }).getByRole("option", {
      name: label!,
      exact: true,
    });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.getByRole("combobox", { name: "Search models" })).toBeHidden();
    await expect(main.getByTestId("model-role-row-1")).toContainText(label!);
    await captureScreenshot(page, testInfo, screenshot!);
  }
});
