import { type WorkspaceAccess, workspaceExternalToolsForChannels } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("./brand", () => ({ brandName: "Manor" }));

import { buildAgentSetupPrompt } from "./agent-setup-prompt";

const access: WorkspaceAccess = {
  organization: { id: "org-a", name: "Harbor Homes" },
  workspace: {
    id: "ws-a",
    name: "Operations",
    slug: "operations",
    channels: ["voice"],
    activityApproval: "manual",
  },
  sources: [],
  tools: workspaceExternalToolsForChannels(["voice"]),
};

describe("organization agent setup", () => {
  it("names the organization and includes only its enabled channel tools", () => {
    const prompt = buildAgentSetupPrompt({ origin: "https://example.test", access });
    expect(prompt).toContain('"Harbor Homes"');
    expect(prompt).toContain('organization.id is "org-a"');
    expect(prompt).toContain("workspace_voice_calls");
    expect(prompt).not.toContain("workspace_utilities");
    expect(prompt).not.toContain("workspace_leasing");
  });
  it("omits workspace endpoints when the organization has no workspace", () => {
    const prompt = buildAgentSetupPrompt({
      origin: "https://example.test",
      access: {
        ...access,
        organization: { id: "org-b", name: "Studio" },
        workspace: null,
        tools: [],
      },
    });
    expect(prompt).toContain('"Studio"');
    expect(prompt).not.toContain("Harbor Homes");
    expect(prompt).not.toContain("/mcp/workspace");
    expect(prompt).toContain("/mcp/crm");
  });
  it("does not include workspace access for a CRM-only token", () => {
    const prompt = buildAgentSetupPrompt({
      origin: "https://example.test",
      access,
      scopes: ["crm:read"],
    });
    expect(prompt).not.toContain("/mcp/workspace");
    expect(prompt).toContain("Granted scopes: crm:read");
  });
});
