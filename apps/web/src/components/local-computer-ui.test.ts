import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.dirname(fileURLToPath(import.meta.url));

function read(relative: string) {
  return readFileSync(path.join(root, relative), "utf8");
}

describe("local computer UI surfaces", () => {
  it("starts sharing only from desktop Settings, not the website or HostComputerPrompt", () => {
    const share = read("ShareThisMacSettings.tsx");
    const settings = read("../pages/AccountSettingsOverlay.tsx");
    const prompt = read("../pages/HostComputerPrompt.tsx");
    const picker = read("ComputerModePicker.tsx");
    const shell = read("../pages/Shell.tsx");

    const enCatalog = read("../locales/en/messages.po");
    expect(enCatalog).toContain('msgid "Share this Mac"');
    expect(enCatalog).toContain(
      'msgid "Pick one folder on this laptop. Writes and shell need Allow once. Overnight work stays on the cloud computer."',
    );
    expect(enCatalog).toContain('msgid "Open Manor desktop to share this Mac."');

    expect(share).toContain("desktopBridge()");
    expect(share).toContain("Share this Mac");
    expect(share).toContain("Pick one folder on this laptop");
    expect(share).toContain("Allow once");
    expect(share).toMatch(/Overnight work stays on\s+the cloud computer/);
    expect(share).toContain("Manor is using this Mac");
    expect(share).not.toContain("Where should bots run");
    expect(share).not.toContain("they run as you");
    expect(share).not.toContain("home folder");
    expect(share).not.toContain("computerHost");

    expect(settings).toContain("ShareThisMacSettings");
    expect(shell).not.toContain("ShareThisMacSettings");
    expect(prompt).not.toContain("Share this Mac");
    expect(prompt).toContain("isLocalServer");

    expect(picker).toContain("This Mac");
    expect(picker).toContain("Open Manor desktop to share this Mac.");
    expect(picker).toContain("Shared folder on this laptop, only while desktop is sharing.");
    expect(picker).not.toContain("Where should bots run");
    expect(picker).not.toContain("they run as you");
    expect(shell).toContain("ComputerModePicker");
    expect(shell).toContain(
      "This bot is using a shared folder on this laptop. Files and shell only.",
    );
  });
});
