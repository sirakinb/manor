/**
 * Copyable documentation examples; never accepts a real token.
 * Client references:
 * https://code.claude.com/docs/en/mcp
 * https://cursor.com/docs/mcp
 * https://developers.openai.com/codex/mcp/
 */
export type McpClient = "claude" | "cursor" | "codex" | "other";
export type McpSurface = "crm" | "workspace";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function mcpConnections(origin: string, organizationId: string, surfaces: McpSurface[]) {
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
    throw new Error("An HTTP origin without credentials is required");
  }
  const id = organizationId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return surfaces.map((surface) => ({
    name: `manor-${id}-${surface}`,
    url: `${base.origin}/mcp/${surface}`,
  }));
}

export function mcpClientSetup(
  client: Exclude<McpClient, "other">,
  connections: ReturnType<typeof mcpConnections>,
) {
  if (client === "cursor") {
    return JSON.stringify(
      {
        mcpServers: Object.fromEntries(
          connections.map(({ name, url }) => [
            name,
            {
              url,
              headers: { Authorization: "Bearer REPLACE_WITH_MANOR_TOKEN" },
            },
          ]),
        ),
      },
      null,
      2,
    );
  }
  if (client === "codex") {
    return connections
      .map(
        ({ name, url }) =>
          `codex mcp add ${shellQuote(name)} --url ${shellQuote(url)} --bearer-token-env-var MANOR_API_TOKEN`,
      )
      .join("\n");
  }
  return connections
    .map(
      ({ name, url }) =>
        `claude mcp add --scope user --transport http ${shellQuote(name)} ${shellQuote(url)} --header 'Authorization: Bearer REPLACE_WITH_MANOR_TOKEN'`,
    )
    .join("\n");
}
