import { describe, expect, it } from "vitest";
import { mcpClientSetup, mcpConnections } from "./mcp-client-setup";

describe("MCP documentation setup", () => {
  const connections = mcpConnections("https://manor.example.com", "org-demo", ["crm", "workspace"]);

  it("gives each organization and data surface a separate connection", () => {
    expect(connections.map((item) => item.url)).toEqual([
      "https://manor.example.com/mcp/crm",
      "https://manor.example.com/mcp/workspace",
    ]);
    expect(connections[0]?.name).not.toBe(connections[1]?.name);
    expect(mcpConnections("https://manor.example.com", "org-other", ["crm"])[0]?.name).not.toBe(
      connections[0]?.name,
    );
  });

  it("creates valid Cursor JSON with bearer headers and only the selected servers", () => {
    const single = mcpConnections("https://manor.example.com", "org-demo", ["crm"]);
    const config = JSON.parse(mcpClientSetup("cursor", single));
    expect(Object.values(config.mcpServers)).toEqual([
      {
        url: "https://manor.example.com/mcp/crm",
        headers: { Authorization: "Bearer REPLACE_WITH_MANOR_TOKEN" },
      },
    ]);
    expect(Object.keys(JSON.parse(mcpClientSetup("cursor", connections)).mcpServers)).toHaveLength(
      2,
    );
  });

  it("uses supported token authentication for each CLI", () => {
    const claude = mcpClientSetup("claude", connections);
    expect(claude.split("\n")).toHaveLength(2);
    expect(claude).toContain("--scope user --transport http");
    expect(claude).toContain("--header 'Authorization: Bearer REPLACE_WITH_MANOR_TOKEN'");
    const codex = mcpClientSetup("codex", connections);
    expect(codex.split("\n")).toHaveLength(2);
    expect(codex).toContain("--bearer-token-env-var MANOR_API_TOKEN");
    expect(codex).not.toContain("mcp login");
  });

  it("keeps names safe for copyable commands and excludes origin paths", () => {
    const [connection] = mcpConnections(
      "https://manor.example.com/a?token=fake",
      "org';echo test",
      ["crm"],
    );
    expect(connection?.name).toMatch(/^[a-z0-9-]+$/);
    expect(connection?.url).toBe("https://manor.example.com/mcp/crm");
  });

  it("rejects credential-bearing and non-HTTP origins", () => {
    expect(() => mcpConnections("https://user:fake@manor.example.com", "org", ["crm"])).toThrow();
    expect(() => mcpConnections("file:///tmp/preview", "org", ["crm"])).toThrow();
  });
});
