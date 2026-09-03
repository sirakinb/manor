import { describe, expect, it } from "vitest";
import {
  type BotCredentialRow,
  findBotCredential,
  formatBotCredentialsPrompt,
  parseBotCredentialSecret,
  resolveBotCredentialValue,
  serializeBotCredentialSecret,
} from "./bot-credentials.js";
import { builtinAgentTools } from "./builtin-tools.js";
import { selectToolsForRoutingMode } from "./executor.js";
import { generateTotp } from "./totp.js";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function row(overrides: Partial<BotCredentialRow> = {}): BotCredentialRow {
  return {
    id: "cred_1",
    label: "Philly Water portal",
    site: "https://example.test/signin",
    username: "aki@example.test",
    notes: "pet question: gizmo",
    hasPassword: true,
    hasTotp: false,
    secretId: "secret_1",
    ...overrides,
  };
}

describe("bot credential secrets", () => {
  it("serializes only the fields that are set and normalizes the TOTP seed", () => {
    expect(serializeBotCredentialSecret({})).toBeNull();
    expect(serializeBotCredentialSecret({ password: "", totp: "" })).toBeNull();
    expect(JSON.parse(serializeBotCredentialSecret({ password: "pw" })!)).toEqual({
      password: "pw",
    });
    expect(
      JSON.parse(serializeBotCredentialSecret({ totp: "otpauth://totp/x?secret=gezd%20gnbv" })!),
    ).toEqual({ totp: "GEZDGNBV" });
  });

  it("rejects a TOTP seed that is not base32", () => {
    expect(() => serializeBotCredentialSecret({ totp: "not!a!seed" })).toThrow();
  });

  it("parses stored payloads defensively", () => {
    expect(parseBotCredentialSecret('{"password":"pw","totp":"ABCD","junk":1}')).toEqual({
      password: "pw",
      totp: "ABCD",
    });
    expect(parseBotCredentialSecret("null")).toEqual({});
  });
});

describe("findBotCredential", () => {
  const rows = [row(), row({ id: "cred_2", label: "PECO electric" })];

  it("matches id, exact label, and a unique partial label", () => {
    expect(findBotCredential(rows, "cred_2")?.label).toBe("PECO electric");
    expect(findBotCredential(rows, "philly water portal")?.id).toBe("cred_1");
    expect(findBotCredential(rows, "peco")?.id).toBe("cred_2");
  });

  it("refuses ambiguous or empty queries", () => {
    expect(findBotCredential(rows, "p")).toBeUndefined();
    expect(findBotCredential(rows, "  ")).toBeUndefined();
  });
});

describe("formatBotCredentialsPrompt", () => {
  it("is absent when nothing is stored", () => {
    expect(formatBotCredentialsPrompt([])).toBeUndefined();
  });

  it("describes what is stored without leaking values", () => {
    const prompt = formatBotCredentialsPrompt([row({ hasTotp: true })])!;
    expect(prompt).toContain('"Philly Water portal"');
    expect(prompt).toContain("username aki@example.test");
    expect(prompt).toContain("stored: password, 2FA code");
    expect(prompt).toContain("notes: pet question: gizmo");
    expect(prompt).toContain("use_credential");
    expect(prompt).toContain("do not request takeover");
  });
});

describe("resolveBotCredentialValue", () => {
  it("returns the username and password when stored", () => {
    expect(resolveBotCredentialValue(row(), { password: "pw" }, "username")).toEqual({
      ok: true,
      text: "aki@example.test",
    });
    expect(resolveBotCredentialValue(row(), { password: "pw" }, "password")).toEqual({
      ok: true,
      text: "pw",
    });
  });

  it("explains what is missing", () => {
    expect(resolveBotCredentialValue(row({ username: "" }), {}, "username")).toMatchObject({
      ok: false,
    });
    expect(resolveBotCredentialValue(row(), {}, "password")).toMatchObject({ ok: false });
    const totp = resolveBotCredentialValue(row(), {}, "totp");
    expect(totp.ok).toBe(false);
    if (!totp.ok) expect(totp.error).toContain("takeover");
  });

  it("generates the current TOTP code and waits out a code about to expire", () => {
    const now = 1_234_567_890_000; // 30s into a step? 1234567890 % 30 = 0 → fresh step
    const fresh = resolveBotCredentialValue(row(), { totp: RFC_SECRET }, "totp", now);
    expect(fresh).toMatchObject({ ok: true, text: generateTotp(RFC_SECRET, { now }) });
    // 27s into the step: fewer than 5s left, so the next step's code is typed instead.
    const late = now + 27_000;
    const rolled = resolveBotCredentialValue(row(), { totp: RFC_SECRET }, "totp", late);
    expect(rolled).toMatchObject({
      ok: true,
      text: generateTotp(RFC_SECRET, { now: late + 3_000 }),
    });
    expect(rolled.ok && rolled.text).not.toBe(generateTotp(RFC_SECRET, { now: late }));
  });
});

describe("use_credential tool exposure", () => {
  const useCredential = builtinAgentTools.find((tool) => tool.name === "use_credential");

  it("exists and asks for a credential label and a field", () => {
    expect(useCredential).toBeDefined();
    expect(useCredential?.inputSchema.required).toEqual(["credential", "field"]);
  });

  it("is dropped with the rest of the computer surface when a turn is pinned to plugins", () => {
    const offered = selectToolsForRoutingMode(
      { computerToolsAvailable: false, pluginToolsAvailable: true },
      builtinAgentTools,
      [],
    ).map((tool) => tool.name);
    expect(offered).not.toContain("use_credential");
    expect(offered).not.toContain("computer_act");
    expect(offered).toContain("request_takeover");
  });

  it("stays offered when a turn is pinned to the computer", () => {
    const offered = selectToolsForRoutingMode(
      { computerToolsAvailable: true, pluginToolsAvailable: false },
      builtinAgentTools,
      [],
    ).map((tool) => tool.name);
    expect(offered).toContain("use_credential");
  });
});

describe("share_preview tool exposure", () => {
  it("is part of the computer surface and needs a port", () => {
    const tool = builtinAgentTools.find((item) => item.name === "share_preview");
    expect(tool?.inputSchema.required).toEqual(["port"]);
    const pinnedToPlugins = selectToolsForRoutingMode(
      { computerToolsAvailable: false, pluginToolsAvailable: true },
      builtinAgentTools,
      [],
    ).map((item) => item.name);
    expect(pinnedToPlugins).not.toContain("share_preview");
  });
});
