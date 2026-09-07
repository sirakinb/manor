import { expect, test } from "@playwright/test";
import type { Routine, RunDiagnostics } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("a failed routine has persistent diagnostics after its banner is dismissed", async ({
  page,
}, testInfo) => {
  await signup(page, `diagnostics-${Date.now()}@rakazo.test`, "password12", "Diagnostics test");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const routine = await rpc<Routine>(page, "routines/create", {
    botId,
    name: "Diagnostics check",
    prompt: "fail this run",
    crons: ["0 9 * * *"],
    timezone: "UTC",
    active: false,
  });
  const { runId } = await rpc<{ runId: string }>(page, "routines/testRun", {
    routineId: routine.id,
  });
  await expect(page.getByTestId("composer-error")).toContainText("Scripted run failure");
  await page.getByRole("button", { name: "View logs", exact: true }).click();
  const logs = page.getByTestId("run-logs");
  await expect(logs.getByTestId("run-log-status")).toHaveText("failed");
  await expect(logs).toContainText(runId);
  await expect(logs).toContainText("run.failed");
  const diagnostic = await rpc<RunDiagnostics>(page, "runs/diagnostics", { runId });
  expect(diagnostic.failure).toEqual({ stage: "execution", category: "unknown", code: null });
  expect(diagnostic.run.trigger).toBe("routine");
  expect(diagnostic.attempts.at(-1)?.status).toBe("failed");
  expect(JSON.stringify(diagnostic)).not.toContain("fail this run");
  await captureScreenshot(page, testInfo, "routine-run-diagnostics");
  await page.reload();
  await page.getByTestId("run-logs-trigger").click();
  await expect(logs).toContainText(runId);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(logs).toBeVisible();
  await expect(page.getByRole("button", { name: "Close panel", exact: true })).toBeVisible();
  const panel = await page.getByTestId("side-panel").boundingBox();
  expect(panel?.width).toBeLessThanOrEqual(390);
  await captureScreenshot(page, testInfo, "routine-run-diagnostics-mobile");
});

test("the computer panel resizes with mouse and keyboard and remembers its width", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signup(page, `resize-${Date.now()}@rakazo.test`, "password12", "Resize test");
  await completeOnboarding(page);
  await page.getByTitle("Agent computer", { exact: true }).click();
  const panel = page.getByTestId("side-panel");
  const handle = page.getByRole("separator", { name: "Resize panel" });
  await expect(handle).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await handle.press("Home");
    await expect.poll(async () => (await panel.boundingBox())!.width).toBe(320);
    // Wait for the handle to receive pointer input before using raw mouse coordinates.
    await handle.hover({ position: { x: 4, y: 100 } });
    const edge = (await handle.boundingBox())!;
    await page.mouse.down();
    await page.mouse.move(edge.x - 200, edge.y + 100, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(470);
  }
  await handle.focus();
  const beforeKeyboard = (await panel.boundingBox())!.width;
  await handle.press("ArrowLeft");
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(beforeKeyboard);
  const saved = (await panel.boundingBox())!.width;
  await captureScreenshot(page, testInfo, "computer-panel-expanded");
  await page.reload();
  await page.getByTitle("Agent computer", { exact: true }).click();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(saved);
  await page.getByRole("button", { name: "Expand computer", exact: true }).click();
  await expect(page.getByTestId("computer-preview")).toContainText("Open in full window");
});
