import { expect, test } from "@playwright/test";
import type { WorkspaceFileResult } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("workspace files can be created, edited, moved to shared files and downloaded", async ({
  page,
}, testInfo) => {
  await signup(page, `files-${Date.now()}@rakazo.test`, "password12", "Files test");
  await completeOnboarding(page);
  await page.getByTestId("files-trigger").click();
  const panel = page.getByTestId("files-panel");
  if (await panel.getByRole("button", { name: "Wake computer" }).isVisible())
    await panel.getByRole("button", { name: "Wake computer" }).click();
  await expect(panel.getByRole("button", { name: "New folder", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "New folder", exact: true }).click();
  await panel.getByRole("textbox", { name: "Name", exact: true }).fill("research");
  await panel.locator("form").getByRole("button", { name: "Save", exact: true }).click();
  await panel
    .getByTestId("files-list")
    .getByRole("button", { name: "research", exact: true })
    .click();
  await panel.getByRole("button", { name: "New file", exact: true }).click();
  await panel.getByRole("textbox", { name: "Name", exact: true }).fill("summary.md");
  await panel.locator("form").getByRole("button", { name: "Save", exact: true }).click();
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "File content" })
    .fill("# Research summary\n\nA useful workspace for the whole team.");
  await panel.getByTestId("files-save").click();
  await expect(panel.getByTestId("files-save")).toBeDisabled();
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Research summary" })).toBeVisible();
  await captureScreenshot(page, testInfo, "files-browse-markdown");
  await panel.getByLabel("Actions for research/summary.md", { exact: true }).click();
  await panel.getByRole("button", { name: "Rename / Move", exact: true }).click();
  await panel.getByRole("combobox", { name: "Destination location" }).selectOption("shared");
  await panel.getByRole("textbox", { name: "Destination path" }).fill("summary.md");
  await panel.locator("form").getByRole("button", { name: "Save", exact: true }).click();
  await panel.getByRole("combobox", { name: "File location" }).selectOption("shared");
  await panel.getByRole("textbox", { name: "Search files" }).fill("summary");
  await expect(
    panel
      .getByTestId("files-list")
      .getByRole("button", { name: /summary.md/ })
      .first(),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download summary.md", exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("summary.md");
  await panel.getByRole("textbox", { name: "Search files" }).fill("");
  await panel.getByLabel("Upload files", { exact: true }).setInputFiles({
    name: "source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Source material"),
  });
  await expect(
    panel.getByTestId("files-list").getByText("source.txt", { exact: true }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "files-shared");
  await panel.getByLabel("Actions for source.txt", { exact: true }).click();
  await panel.getByRole("button", { name: "Delete", exact: true }).click();
  await panel.locator("form").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    panel.getByTestId("files-list").getByText("source.txt", { exact: true }),
  ).toHaveCount(0);
});

test("unsaved drafts survive closing Files and stale edits cannot overwrite bot work", async ({
  page,
}, testInfo) => {
  await signup(page, `file-draft-${Date.now()}@rakazo.test`, "password12", "Draft test");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "computer/boot", { botId });
  await rpc(page, "computer/writeFile", { botId, path: "notes.txt", content: "Original" });
  await page.getByTestId("files-trigger").click();
  const panel = page.getByTestId("files-panel");
  // Refresh the shell's computer status after booting through the test API.
  if (await panel.getByRole("button", { name: "Wake computer" }).isVisible())
    await panel.getByRole("button", { name: "Wake computer" }).click();
  await panel.getByTestId("files-list").getByText("notes.txt", { exact: true }).click();
  await panel.getByRole("textbox", { name: "File content" }).fill("My draft");
  await page.getByTestId("files-trigger").click();
  await page.getByTestId("files-trigger").click();
  await expect(panel.getByRole("textbox", { name: "File content" })).toHaveValue("My draft");
  await rpc(page, "computer/writeFile", {
    botId,
    path: "notes.txt",
    content: "Changed on computer",
  });
  await panel.getByRole("button", { name: "Refresh files" }).click();
  await expect(
    panel.getByText("This file changed on the computer. Your edits are still here."),
  ).toBeVisible();
  await expect(panel.getByTestId("files-save")).toBeDisabled();
  await expect(panel.getByRole("textbox", { name: "File content" })).toHaveValue("My draft");
  await captureScreenshot(page, testInfo, "files-stale-draft");
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Reload file" }).click();
  await expect(panel.getByRole("textbox", { name: "File content" })).toHaveValue(
    "Changed on computer",
  );
  await panel.getByRole("button", { name: "Attach to chat" }).click();
  await expect(page.getByRole("button", { name: "Remove notes.txt", exact: true })).toBeVisible();
});

test("Changes exposes repositories, branches, selected commits and diffs", async ({
  page,
}, testInfo) => {
  await signup(page, `file-git-${Date.now()}@rakazo.test`, "password12", "Git test");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "computer/boot", { botId });
  let committed = false;
  await page.route("**/rpc/computer/workspace", async (route) => {
    const request = route.request().postDataJSON().json;
    const op = request.operation;
    let result: WorkspaceFileResult;
    if (op.action === "git-status")
      result = {
        kind: "git",
        truncated: false,
        repos: [
          {
            path: "site",
            branch: "main",
            branches: ["main", "draft"],
            revision: "a".repeat(64),
            files: committed ? [] : [{ path: "README.md", status: "modified" }],
          },
        ],
      };
    else if (op.action === "git-diff")
      result = {
        kind: "diff",
        diff: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-Old introduction\n+New introduction",
        truncated: false,
      };
    else if (op.action === "git-commit") {
      expect(op.files).toEqual(["README.md"]);
      expect(op.message).toBe("Update introduction");
      committed = true;
      result = { kind: "ok" };
    } else {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: result }),
    });
  });
  await page.getByTestId("files-trigger").click();
  const panel = page.getByTestId("files-panel");
  if (await panel.getByRole("button", { name: "Wake computer" }).isVisible())
    await panel.getByRole("button", { name: "Wake computer" }).click();
  await panel.getByTestId("files-tab-changes").click();
  await panel.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(panel.getByTestId("files-diff")).toContainText("+New introduction");
  await panel.getByRole("checkbox", { name: "Include README.md in commit" }).check();
  await panel.getByRole("textbox", { name: "Commit message" }).fill("Update introduction");
  await captureScreenshot(page, testInfo, "files-git-review");
  await panel.getByRole("button", { name: "Commit selected files" }).click();
  await expect(panel.getByText("Working tree clean", { exact: true })).toBeVisible();
});

test("images and PDFs preview in Files without opening an editor", async ({ page }, testInfo) => {
  await signup(page, `file-preview-${Date.now()}@rakazo.test`, "password12", "Preview test");
  await completeOnboarding(page);
  await page.getByTestId("files-trigger").click();
  const panel = page.getByTestId("files-panel");
  if (await panel.getByRole("button", { name: "Wake computer" }).isVisible())
    await panel.getByRole("button", { name: "Wake computer" }).click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await panel
    .getByLabel("Upload files", { exact: true })
    .setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: png });
  await panel.getByRole("button", { name: "sample.png", exact: true }).click();
  await expect(panel.getByRole("img", { name: "sample.png" })).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "File content" })).toHaveCount(0);
  await panel
    .getByLabel("Upload files", { exact: true })
    .setInputFiles({ name: "sample.pdf", mimeType: "application/pdf", buffer: previewPdf() });
  await panel.getByRole("button", { name: "sample.pdf", exact: true }).click();
  await expect(panel.getByLabel("PDF preview", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("PDF page 1", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("pdf-page-text")).toContainText("Workspace PDF preview");
  await expect(panel.getByRole("textbox", { name: "File content" })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "files-pdf-preview");
});

function previewPdf(): Buffer {
  const content = "BT /F1 24 Tf 40 220 Td (Workspace PDF preview) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
