import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

const fixture = "/e2e/fixtures/tool-activity.html";
const REPLY_TEXT = "Tuesday at 2 pm is free.";
const STORAGE_KEY = "rakazo.showToolActivity";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
];

async function openThread(page: Page, phase: "live" | "done") {
  await page.goto(`${fixture}?view=thread&phase=${phase}`);
  await expect(page.getByTestId("message-user-bubble")).toBeVisible();
}

/** Cards stay hidden until this browser saved "on". Seed only when a test needs them visible. */
async function seedToolActivityOn(page: Page) {
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) == null) localStorage.setItem(key, "on");
  }, STORAGE_KEY);
}

test("tool activity shows for live and finished runs when the user turned it on", async ({
  page,
}, testInfo) => {
  await seedToolActivityOn(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    await openThread(page, "live");
    const liveLine = page.getByTestId("tool-activity-line");
    await expect(liveLine).toHaveCount(1);
    await expect(page.getByTestId("message-bot-bubble")).toHaveCount(0);
    const liveCard = page.getByTestId("tool-activity");
    await expect(liveCard.locator("button[aria-expanded]")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(liveCard.locator("button[aria-expanded]")).toContainText("Working… · 8 tools");
    await expect(page.getByTestId("tool-rows-hidden")).toHaveText("+2 earlier steps");
    await expect(page.getByTestId("tool-rows")).not.toContainText("Open calendar");
    await expect(page.getByTestId("tool-rows")).toContainText("Check conflicts");
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
    await captureScreenshot(page, testInfo, `default-live-${viewport.name}`);

    await liveCard.locator("button[aria-expanded]").click();
    await expect(liveCard.locator("button[aria-expanded]")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await openThread(page, "done");
    await expect(page.getByTestId("message-bot-bubble")).toHaveText(REPLY_TEXT);
    const doneCard = page.getByTestId("tool-activity");
    await expect(doneCard).toHaveCount(1);
    await expect(doneCard.locator("button[aria-expanded]")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(doneCard.locator("button[aria-expanded]")).toContainText("Done · 8 tools · 12s");
    await captureScreenshot(page, testInfo, `default-done-collapsed-${viewport.name}`);

    await doneCard.locator("button[aria-expanded]").click();
    await expect(doneCard.locator("button[aria-expanded]")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByTestId("tool-rows-hidden")).toHaveCount(0);
    await expect(page.getByTestId("tool-rows")).toContainText("Open calendar");
    await expect(page.getByTestId("tool-rows")).toContainText("Check conflicts");
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
    await captureScreenshot(page, testInfo, `default-done-expanded-${viewport.name}`);
  }
});

test("settings offer no tool activity toggle and the cards follow the stored preference", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // Manor's chat always shows tool activity, so its settings hide upstream's switch.
  await page.goto(`${fixture}?view=settings`);
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();
  await settings.getByTestId("advanced-settings").locator("button[aria-expanded]").click();
  await expect(settings.getByText("Stream replies", { exact: true })).toBeVisible();
  await expect(settings.getByTestId("tool-activity-toggle")).toBeHidden();
  await expect(settings.getByText("Show tool activity", { exact: true })).toBeHidden();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBeNull();
  await captureScreenshot(page, testInfo, "settings-without-tool-activity-toggle");

  // The collapsible cards (still used outside the chat) stay hidden until "on" is stored.
  await openThread(page, "done");
  await expect(page.getByTestId("message-bot-bubble")).toHaveText(REPLY_TEXT);
  await expect(page.getByTestId("tool-activity")).toHaveCount(0);
  await expect(page.getByText("Done · 8 tools", { exact: false })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "off-done");

  await openThread(page, "live");
  await expect(page.getByTestId("tool-activity")).toHaveCount(0);
  await expect(page.getByTestId("tool-activity-line")).toHaveCount(0);
  await expect(page.getByTestId("message-bot-bubble")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "off-live");

  await page.evaluate((key) => localStorage.setItem(key, "on"), STORAGE_KEY);

  await openThread(page, "done");
  await expect(page.getByTestId("tool-activity")).toHaveCount(1);
  await expect(page.getByTestId("tool-activity").locator("button[aria-expanded]")).toContainText(
    "Done · 8 tools",
  );
  await captureScreenshot(page, testInfo, "on-again-done");
});

test("the chat transcript always shows tool activity, whatever preference is stored", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  await signup(page, `tool-activity-${stamp}@rakazo.test`, "password12", "Tool Activity");
  await completeOnboarding(page);

  // The scripted runtime answers this with one write_file call, then a short reply.
  await page
    .getByPlaceholder(/^Message /)
    .fill("write a note called notes/tool-activity.txt that says fake e2e note");
  await page.getByRole("button", { name: "Send" }).click();

  const transcript = page.getByTestId("transcript");
  await expect(transcript.getByText("writing that into my home now.")).toBeVisible({
    timeout: 30_000,
  });
  // Manor's timeline lists the steps in the open: no card to expand, nothing folded away.
  const timeline = transcript.getByTestId("activity-timeline");
  await expect(timeline.first()).toBeVisible();
  await expect(timeline.first().getByTestId("tool-rows").first()).toBeVisible();
  await expect(timeline.first().getByTestId("tool-rows").first()).not.toBeEmpty();
  await expect(transcript.getByTestId("tool-activity")).toHaveCount(0);
  await expect(transcript.getByTestId("narration").locator("details, summary")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "shell-activity-timeline");

  const settings = await openUserSettings(page);
  await settings.getByTestId("advanced-settings").locator("button[aria-expanded]").click();
  await expect(settings.getByText("Stream replies", { exact: true })).toBeVisible();
  await expect(settings.getByTestId("tool-activity-toggle")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // A stored "off" from upstream's preference does not hide the timeline.
  await page.evaluate((key) => localStorage.setItem(key, "off"), STORAGE_KEY);
  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(transcript.getByText("writing that into my home now.")).toBeVisible();
  await expect(timeline.first()).toBeVisible();
  await expect(timeline.first().getByTestId("tool-rows").first()).toBeVisible();
});
