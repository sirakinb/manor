import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("checker comparison shows both engines side by side and downloads a report", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `checker-comparison-${stamp}@rakazo.test`, "password12", "Comparison UI");
  await completeOnboarding(page, testInfo);

  // A model key makes the LLM checker available next to the harness's Jev emulator. The scripted
  // runtime answers checker prompts, so nothing leaves the machine.
  await rpc(page, "models/connect", { provider: "openrouter", apiKey: "fake-e2e-openrouter-key" });
  await rpc(page, "autoReview/set", {
    enabled: true,
    checkAnswers: true,
    engine: "jev",
    compare: true,
  });

  await page.getByPlaceholder(/Message/).fill("write this to the destination crm as a note");
  await page.keyboard.press("Enter");
  const botId = activeBotId(page);
  await expect
    .poll(
      async () =>
        (await rpc<{ run?: { status: string } | null }>(page, "threads/get", { botId })).run
          ?.status ?? null,
      { timeout: 30_000 },
    )
    .toBeNull();
  // Compare-mode verdicts are logged just after the run ends.
  await expect
    .poll(async () =>
      (
        await rpc<{ checkpoints: Array<{ compared: number }> }>(page, "verification/summary", {
          days: 30,
        })
      ).checkpoints.reduce((sum, checkpoint) => sum + checkpoint.compared, 0),
    )
    .toBe(2);

  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByTestId("user-settings");
  await settings.getByText("Advanced", { exact: true }).click();
  await settings.getByTestId("open-checker-comparison").click();

  const comparison = page.getByTestId("checker-comparison");
  await expect(comparison).toBeFocused();
  await expect(comparison.getByTestId("checker-card")).toHaveCount(2);
  await expect(comparison.getByTestId("checker-agreement")).toContainText(
    "Agreed on 1 of 1 checks",
  );
  await captureScreenshot(page, testInfo, "60-checker-comparison-actions");

  // Jev finds the reply unsupported while the LLM checker accepts it.
  await comparison.getByRole("tab", { name: "Replies" }).click();
  await expect(comparison.getByTestId("checker-agreement")).toContainText(
    "Agreed on 0 of 1 checks",
  );
  const row = comparison.getByTestId("disagreements").getByRole("row").nth(1);
  await expect(row).toContainText("Unsupported");
  await expect(row).toContainText("Supported");
  await row.getByRole("button").click();
  const unsupported = comparison.getByText(
    "✗ writing the record through the connected destination.",
  );
  await expect(unsupported).toBeVisible();
  await unsupported.scrollIntoViewIfNeeded();
  await expect(comparison.getByRole("link", { name: "Open chat" })).toHaveAttribute(
    "href",
    `/app/${botId}`,
  );
  await captureScreenshot(page, testInfo, "61-checker-comparison-reply-disagreement");

  const download = page.waitForEvent("download");
  await comparison.getByRole("button", { name: "Report (.md)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^checker-comparison-.*\.md$/);

  await page.keyboard.press("Escape");
  await expect(comparison).toHaveCount(0);
  await expect(settings).toBeVisible();
});
