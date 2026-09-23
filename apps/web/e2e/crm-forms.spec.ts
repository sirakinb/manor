import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("organization owners manage event signup forms from the CRM", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `crm-forms-${stamp}@rakazo.test`, "password12", "Forms Owner");
  await completeOnboarding(page, testInfo);

  await page.goto("/app/crm");
  await page.getByRole("button", { name: "Forms", exact: true }).click();
  const forms = page.getByTestId("crm-forms");
  await expect(forms.getByText("No forms yet.")).toBeVisible();

  await forms.getByRole("button", { name: "New event signup" }).click();
  const editor = page.getByTestId("crm-form-editor");
  const slug = `demo-night-${stamp}`;
  await editor.getByLabel("Title").fill("Demo Night");
  await editor.getByLabel("Address").fill(slug);
  await editor.getByLabel("Starts").fill("2026-09-24T19:00");
  await editor.getByLabel("Join link").fill("https://us06web.zoom.us/j/1234567890");
  await editor.getByLabel("Email message").fill("Bring questions.");
  await editor.getByLabel("CRM tag").fill("Demo Night");
  await editor.getByLabel("Notify").fill("owner@example.test");
  await editor.getByLabel("Sender name").fill("Demo Host");
  await editor.getByLabel("Sign-off").fill("Sam");
  await editor.getByLabel("Allowed websites").fill("https://events.example.test");
  await expect(editor.getByText(`/v1/public/forms/${slug}`)).toBeVisible();
  await captureScreenshot(page, testInfo, "62-crm-event-form-editor");

  await editor.getByRole("button", { name: "Save" }).click();
  await expect(forms.getByText("Demo Night")).toBeVisible();
  await expect(forms.getByText("Live · Event")).toBeVisible();
  await captureScreenshot(page, testInfo, "63-crm-forms-list");

  // The wall-clock time the owner typed is stored as the matching instant in New York.
  const saved = await rpc<{ forms: Array<{ slug: string; eventStartsAt: string | null }> }>(
    page,
    "publicForms/list",
    {},
  );
  expect(saved.forms.find((form) => form.slug === slug)?.eventStartsAt).toBe(
    "2026-09-24T23:00:00.000Z",
  );
});
