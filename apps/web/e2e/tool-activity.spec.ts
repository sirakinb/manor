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

// The fixture renders the real chat transcript. Manor's transcript lists tool steps in its
// activity timeline whatever upstream's stored preference says, so no card ever appears.
for (const stored of [null, "off", "on"] as const) {
  test(`the fixture transcript lists every step for live and finished runs (stored: ${stored})`, async ({
    page,
  }, testInfo) => {
    if (stored) {
      await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
        STORAGE_KEY,
        stored,
      ] as const);
    }
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const phase of ["live", "done"] as const) {
        await openThread(page, phase);
        const transcript = page.getByTestId("transcript");
        const timeline = transcript.getByTestId("activity-timeline");
        await expect(timeline.first()).toBeVisible();
        await expect(timeline.first()).toContainText("Open calendar");
        await expect(timeline.first()).toContainText("Check conflicts");
        await expect(transcript.getByTestId("tool-activity")).toHaveCount(0);
        if (phase === "done") {
          await expect(page.getByTestId("message-bot-bubble")).toContainText(REPLY_TEXT);
        } else {
          await expect(transcript.getByTestId("live-status")).toBeVisible();
        }
        await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
        await captureScreenshot(
          page,
          testInfo,
          `timeline-${phase}-${stored ?? "unset"}-${viewport.name}`,
        );
      }
    }
  });
}

test("settings offer no tool activity toggle", async ({ page }, testInfo) => {
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
