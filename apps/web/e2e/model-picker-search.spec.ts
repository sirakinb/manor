import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  openModelConnection,
  openUserSettings,
  signup,
} from "./helpers";

test("recent models are selectable through OpenRouter and subscriptions", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const userName = `Recent models ${stamp}`;
  await signup(page, `recent-models-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page);
  await openUserSettings(page, "models");
  await expect(page.getByRole("button", { name: "Close model settings" })).toBeVisible();

  for (const [provider, query, label, screenshot] of [
    ["OpenRouter", "Fable 5.1", "Anthropic: Claude Fable 5.1", "openrouter-fable-5-1"],
    ["OpenRouter", "Opus 5.5", "Anthropic: Claude Opus 5.5", "openrouter-opus-5-5"],
    ["OpenRouter", "GPT-6 Astra", "OpenAI: GPT-6 Astra", "openrouter-gpt-6-astra"],
    ["OpenRouter", "GPT-6 Sol", "OpenAI: GPT-6 Sol", "openrouter-gpt-6-sol"],
    ["OpenRouter", "GPT-6 Luna", "OpenAI: GPT-6 Luna", "openrouter-gpt-6-luna"],
    ["OpenRouter", "V4.1 Flash", "DeepSeek: DeepSeek V4.1 Flash", "openrouter-deepseek-v4-1-flash"],
    ["Anthropic", "Fable 5.1", "Claude Fable 5.1", "subscription-fable-5-1"],
    ["Anthropic", "Opus 5.5", "Claude Opus 5.5", "subscription-opus-5-5"],
    ["OpenAI Codex", "GPT-6 Astra", "GPT-6 Astra", "subscription-gpt-6-astra"],
    ["OpenAI Codex", "GPT-6 Sol", "GPT-6 Sol", "subscription-gpt-6-sol"],
    ["OpenAI Codex", "GPT-6 Luna", "GPT-6 Luna", "subscription-gpt-6-luna"],
  ]) {
    await page.getByPlaceholder("Search providers").fill(provider!);
    await page.getByRole("button", { name: new RegExp(provider!) }).click();
    const modelCombobox = page.getByRole("combobox", { name: "Model", exact: true });
    await modelCombobox.click();
    await page.getByRole("combobox", { name: "Search models" }).fill(query!);
    const option = page.getByRole("listbox", { name: "Model options" }).getByRole("option", {
      name: label!,
      exact: true,
    });
    await expect(option).toBeVisible();
    await option.click();
    await expect(modelCombobox).toHaveText(label!);
    await captureScreenshot(page, testInfo, screenshot!);
  }
});

test("model dropdown search and provider group headers", async ({ page }, testInfo) => {
  const stamp = Date.now();
  const userName = `Model picker ${stamp}`;
  await signup(page, `model-picker-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page);

  await openUserSettings(page, "models");

  // OpenRouter has many models so group headers and search are obvious. Connecting it
  // reopens the main model's picker on its models.
  const dialog = await openModelConnection(page, "OpenRouter");
  await dialog.getByLabel("API key").fill("fake-picker-api-key");
  await dialog.getByRole("button", { name: "Connect API key", exact: true }).click();
  await expect(dialog).toBeHidden();

  const modelSearch = page.getByRole("combobox", { name: "Search models" });
  const modelOptions = page.getByRole("listbox", { name: "Model options" });
  await expect(modelSearch).toBeVisible();
  await expect(modelSearch).toHaveAttribute("placeholder", "Search");
  await expect(modelSearch).toHaveValue("OpenRouter");
  await expect(modelOptions).toBeVisible();
  await expect(
    modelOptions.locator("[cmdk-group-heading]", { hasText: /^OpenRouter$/ }),
  ).toBeVisible();

  await captureScreenshot(page, testInfo, "model-picker-dropdown-groups");

  await modelSearch.fill("claude");
  const optionTexts = await modelOptions.getByRole("option").allTextContents();
  expect(optionTexts.length).toBeGreaterThan(0);
  expect(optionTexts.every((text) => /claude/i.test(text))).toBe(true);
  await expect(page.getByText("No matching models")).toBeHidden();

  await captureScreenshot(page, testInfo, "model-picker-dropdown-filtered");

  const firstActive = await modelSearch.getAttribute("aria-activedescendant");
  expect(firstActive).toBeTruthy();
  await modelSearch.press("ArrowDown");
  await expect(modelSearch).toBeFocused();
  const afterDown = await modelSearch.getAttribute("aria-activedescendant");
  expect(afterDown).toBeTruthy();
  expect(afterDown).not.toBe(firstActive);

  await modelSearch.press("Home");
  await expect(modelSearch).toBeFocused();
  await expect(modelSearch).toHaveAttribute("aria-activedescendant", firstActive!);

  await modelSearch.press("End");
  await expect(modelSearch).toBeFocused();
  const afterEnd = await modelSearch.getAttribute("aria-activedescendant");
  expect(afterEnd).toBeTruthy();
  expect(afterEnd).not.toBe(firstActive);

  await modelSearch.press("ArrowUp");
  await expect(modelSearch).toBeFocused();
  const afterUp = await modelSearch.getAttribute("aria-activedescendant");
  expect(afterUp).toBeTruthy();
  expect(afterUp).not.toBe(afterEnd);

  // Models come before providers that still need connecting, so the first match is a model.
  await modelSearch.press("Home");
  const first = page.locator(`[id="${firstActive}"]`);
  const selectedLabel = ((await first.locator("span").first().textContent()) ?? "").trim();
  expect(selectedLabel.length).toBeGreaterThan(0);
  await modelSearch.press("Enter");
  await expect(modelSearch).toBeHidden();
  const primary = page.getByTestId("model-role-main").getByTestId("model-role-row-1");
  await expect(primary).toContainText(selectedLabel);

  await primary.getByRole("button", { name: /^Change / }).click();
  await expect(modelSearch).toBeVisible();
  await modelSearch.fill("no-model-matches-this");
  await expect(page.getByText("No matching models")).toBeVisible();
  await expect(modelOptions.getByRole("option")).toHaveCount(0);
});
