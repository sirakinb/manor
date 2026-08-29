import {
  CONTACT_ENDPOINTS,
  DEAL_ENDPOINTS,
  type Endpoint,
  MCP_TOOLS,
  MODULE_ENDPOINTS,
  STATUS_CODES,
  WEBHOOK_ENDPOINTS,
  WEBHOOK_EVENTS,
} from "./api-catalog";
import { brandName } from "./brand";

function endpointLines(endpoints: Endpoint[]): string {
  return endpoints.map((e) => `- ${e.method} ${e.path} (${e.scope}) — ${e.summary}`).join("\n");
}

// Deliberately English-only: this text is consumed by coding agents, not shown as UI copy.
export function buildAgentSetupPrompt(options: { origin: string; token?: string }): string {
  const { origin } = options;
  const token = options.token ?? `<your ${brandName} API token>`;
  const serverName = `${brandName.toLowerCase()}-crm`;
  const toolLines = MCP_TOOLS.map(
    (tool) => `- ${tool.name}(${tool.args}) — ${tool.writes ? "read/write" : "read-only"}`,
  ).join("\n");

  return `Connect this environment to my ${brandName} CRM over MCP so you can read and write my CRM data directly.

## Credentials

- MCP endpoint (streamable HTTP): ${origin}/mcp/crm
- API token: ${token}
- Auth header on every request: Authorization: Bearer <token>
- The token is a secret. Keep it in an environment variable or server-side config (e.g. MANOR_API_TOKEN). Never put it in client-side code, commit it to git, or log it.

## Connect over MCP

Pick whichever matches this environment:

- Claude Code:

    claude mcp add --transport http ${serverName} ${origin}/mcp/crm --header "Authorization: Bearer <token>"

- Cursor / any client that reads mcp.json:

    {
      "mcpServers": {
        "${serverName}": {
          "url": "${origin}/mcp/crm",
          "headers": { "Authorization": "Bearer <token>" }
        }
      }
    }

- Claude (web/desktop): Settings → Connectors → Add custom connector, paste the URL and token.

Once connected, these tools are available (tools the token cannot use are not advertised):

${toolLines}

Record tools address modules by name or id, and record "values" use field labels as keys, e.g. {"module": "Tenants", "values": {"Rent": 1450}} — no internal ids needed.

## Verify the connection

1. Call crm_overview over MCP and confirm it returns workspace data.
2. Tell me what you found — contact count, pipelines, modules — and how you connected.

## Reference: REST API

If part of this project is a plain script or server that should call HTTP directly, the same token works against the REST API. Full machine-readable spec: ${origin}/v1/openapi.json

Contacts:
${endpointLines(CONTACT_ENDPOINTS)}

Pipelines and deals:
${endpointLines(DEAL_ENDPOINTS)}

Custom modules and records:
${endpointLines(MODULE_ENDPOINTS)}

Webhook management:
${endpointLines(WEBHOOK_ENDPOINTS)}

Conventions:
- List endpoints paginate with next_cursor; pass it back as ?cursor= to continue.
- Upserts match on source + external_id (or email), so replaying a call never duplicates data.
- Send an Idempotency-Key header on writes to make retries safe (keys live 24 hours; reusing a key with a different payload returns 409).
- Status codes: ${STATUS_CODES.map((s) => `${s.code} = ${s.meaning.toLowerCase()}`).join("; ")}.

## Reference: outbound webhooks

To react to CRM changes, create an endpoint with POST /v1/webhooks (scope webhooks:manage). Events: ${WEBHOOK_EVENTS.join(", ")}. Deliveries are signed with HMAC-SHA256 of "<timestamp>.<raw body>" in the x-${brandName.toLowerCase()}-signature header ("v1=<hex>"); verify with a constant-time compare and reject stale timestamps. Failed deliveries retry up to 8 times with exponential backoff.`;
}
