import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { brandName } from "../lib/brand";

type DocsTab = "start" | "rest" | "mcp" | "webhooks";

const SCOPES = [
  { scope: "crm:read", grants: "Read contacts, pipelines, deals, modules, records" },
  { scope: "crm:write", grants: "Create and update CRM data over REST and MCP" },
  { scope: "webhooks:manage", grants: "List, create, and delete webhook endpoints" },
];

const STATUS_CODES = [
  { code: "400", meaning: "Validation failed; the message says which field" },
  { code: "401", meaning: "Missing, revoked, or malformed token" },
  { code: "403", meaning: "Token lacks the required scope" },
  { code: "404", meaning: "Resource is not in this workspace" },
  { code: "409", meaning: "Idempotency-Key reused with a different payload" },
];

type Endpoint = { method: string; path: string; scope: string; summary: string };

const CONTACT_ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/v1/crm/contacts",
    scope: "crm:read",
    summary: "List contacts; filter with updated_after",
  },
  { method: "GET", path: "/v1/crm/contacts/:id", scope: "crm:read", summary: "Get one contact" },
  {
    method: "POST",
    path: "/v1/crm/contacts/upsert",
    scope: "crm:write",
    summary: "Create or update by source + external_id or email",
  },
];

const DEAL_ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/v1/crm/pipelines",
    scope: "crm:read",
    summary: "List pipelines with their stages",
  },
  { method: "GET", path: "/v1/crm/deals", scope: "crm:read", summary: "List deals" },
  {
    method: "POST",
    path: "/v1/crm/deals",
    scope: "crm:write",
    summary: "Create a deal in a pipeline stage",
  },
  {
    method: "PATCH",
    path: "/v1/crm/deals/:id",
    scope: "crm:write",
    summary: "Update title, value, contact, or status",
  },
  {
    method: "POST",
    path: "/v1/crm/deals/:id/move",
    scope: "crm:write",
    summary: "Move a deal to another stage",
  },
];

const MODULE_ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/v1/crm/modules",
    scope: "crm:read",
    summary: "List custom modules and their fields",
  },
  {
    method: "POST",
    path: "/v1/crm/modules",
    scope: "crm:write",
    summary: "Create a module (a user-defined sheet)",
  },
  {
    method: "GET",
    path: "/v1/crm/modules/:id/records",
    scope: "crm:read",
    summary: "List records in a module",
  },
  {
    method: "POST",
    path: "/v1/crm/modules/:id/records",
    scope: "crm:write",
    summary: "Create a record",
  },
  {
    method: "PATCH",
    path: "/v1/crm/records/:id",
    scope: "crm:write",
    summary: "Update record values; null clears a field",
  },
  {
    method: "DELETE",
    path: "/v1/crm/records/:id",
    scope: "crm:write",
    summary: "Delete a record",
  },
];

const WEBHOOK_ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/v1/webhooks",
    scope: "webhooks:manage",
    summary: "List webhook endpoints",
  },
  {
    method: "POST",
    path: "/v1/webhooks",
    scope: "webhooks:manage",
    summary: "Create an endpoint; returns its signing secret once",
  },
  {
    method: "DELETE",
    path: "/v1/webhooks/:id",
    scope: "webhooks:manage",
    summary: "Delete an endpoint",
  },
];

const MCP_TOOLS = [
  { name: "crm_overview", args: "—", writes: false },
  { name: "crm_find_contacts", args: "query", writes: false },
  { name: "crm_upsert_contact", args: "contact_id?, first_name?, email?, tags?, …", writes: true },
  { name: "crm_sync_contact", args: "source?, external_id?, email?, …", writes: true },
  { name: "crm_create_deal", args: "title, value, pipeline?, stage?, contact_name?", writes: true },
  { name: "crm_update_deal", args: "deal_id, title?, value?, status?", writes: true },
  { name: "crm_move_deal", args: "deal_id, stage", writes: true },
  { name: "crm_list_modules", args: "—", writes: false },
  { name: "crm_create_module", args: "name, fields?", writes: true },
  { name: "crm_list_records", args: "module, cursor?", writes: false },
  { name: "crm_upsert_record", args: "module?, record_id?, values", writes: true },
  { name: "crm_delete_record", args: "record_id", writes: true },
];

const WEBHOOK_EVENTS = [
  "contact.created",
  "contact.updated",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
  "record.created",
  "record.updated",
];

/** The Manor API reference. The CRM is the first surface; new areas add tabs here. */
export function DocsView() {
  const { t } = useLingui();
  const [tab, setTab] = useState<DocsTab>("start");
  const origin = window.location.origin;

  const tabs: Array<{ key: DocsTab; label: string }> = [
    { key: "start", label: t`Getting started` },
    { key: "rest", label: t`REST` },
    { key: "mcp", label: "MCP" },
    { key: "webhooks", label: t`Webhooks` },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0D0D0E]">
      <div className="flex items-center justify-between border-b border-[#141416] px-[22px] py-[13px]">
        <div className="flex items-center gap-5">
          <span className="text-[16px] font-medium tracking-[0.01em] text-[#ECECEE]">
            <Trans>Documentation</Trans>
          </span>
          <div className="flex items-center gap-1 rounded-full border border-[#202023] bg-[#131315] p-1">
            {tabs.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setTab(entry.key)}
                className={`rounded-full px-3.5 py-1 text-[13px] transition-colors ${
                  tab === entry.key
                    ? "bg-[#232326] text-[#ECECEE]"
                    : "text-[#85858A] hover:text-[#C9C9CE]"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <a
          href="/v1/openapi.json"
          target="_blank"
          rel="noreferrer"
          title={t`Machine-readable OpenAPI 3.1 document`}
          className="text-[13px] text-[#AEB5FF] hover:text-[#D1D5FF]"
        >
          <Trans>OpenAPI (JSON) ↗</Trans>
        </a>
      </div>

      <div className="rk-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-[22px] py-6">
          {tab === "start" ? <GettingStarted origin={origin} /> : null}
          {tab === "rest" ? <RestReference origin={origin} /> : null}
          {tab === "mcp" ? <McpReference origin={origin} /> : null}
          {tab === "webhooks" ? <WebhooksReference origin={origin} /> : null}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2.5 text-[14px] font-semibold text-[#ECECEE]">{title}</h2>
      {children}
    </section>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[13.5px] leading-6 text-[#A8A8AD]">{children}</p>;
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mb-3 overflow-x-auto rounded-xl border border-[#202023] bg-[#131315] p-4 font-mono text-[12px] leading-[1.7] text-[#C9C9CE]">
      {children}
    </pre>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-[#1C1C1F] px-1.5 py-0.5 font-mono text-[12px] text-[#C9C9CE]">
      {children}
    </code>
  );
}

function EndpointTable({ endpoints }: { endpoints: Endpoint[] }) {
  return (
    <Table
      head={[
        <Trans key="e">Endpoint</Trans>,
        <Trans key="s">Scope</Trans>,
        <Trans key="d">Description</Trans>,
      ]}
      rows={endpoints.map((row) => [
        <span key="e" className="whitespace-nowrap font-mono text-[12px]">
          <span className="text-[#8AB7FF]">{row.method}</span> {row.path}
        </span>,
        <Mono key="s">{row.scope}</Mono>,
        row.summary,
      ])}
    />
  );
}

function GettingStarted({ origin }: { origin: string }) {
  return (
    <>
      <Prose>
        <Trans>
          The {brandName} API connects websites, automation tools, and AI clients to this workspace.
          It speaks plain REST for scripts and servers, MCP for AI clients, and webhooks for pushing
          changes back to you. The CRM is the first surface it covers; new areas will appear here as
          they open up.
        </Trans>
      </Prose>
      <Section title={<Trans>Base URL</Trans>}>
        <Code>{origin}</Code>
        <Prose>
          <Trans>
            All endpoints are under <Mono>/v1</Mono>, all payloads are JSON, and everything is
            scoped to this workspace — a token can never see another workspace's data.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>1 · Create a token</Trans>}>
        <Prose>
          <Trans>
            Open Integrations → CRM API access, name the credential, pick its scopes, and copy the
            token — it is shown once. Tokens start with <Mono>manor_</Mono> and can be revoked at
            any time.
          </Trans>
        </Prose>
        <Table
          head={[<Trans key="s">Scope</Trans>, <Trans key="g">Grants</Trans>]}
          rows={SCOPES.map((row) => [<Mono key="s">{row.scope}</Mono>, row.grants])}
        />
      </Section>
      <Section title={<Trans>2 · Make a request</Trans>}>
        <Prose>
          <Trans>
            Send the token as a bearer header on every call. This lists the workspace's contacts:
          </Trans>
        </Prose>
        <Code>{`curl ${origin}/v1/crm/contacts \\
  -H "Authorization: Bearer manor_..."

{
  "data": [
    {
      "id": "cmf…",
      "first_name": "Ana",
      "last_name": "Rivera",
      "company": "Rivera Holdings",
      "email": null,
      "phone": null,
      "status": "active",
      "tags": ["VIP"],
      "created_at": "2026-08-29T02:11:00.000Z",
      "updated_at": "2026-08-29T02:11:00.000Z"
    }
  ],
  "next_cursor": null
}`}</Code>
      </Section>
      <Section title={<Trans>3 · Write something</Trans>}>
        <Prose>
          <Trans>
            Writes need the <Mono>crm:write</Mono> scope. Upsert is the safest way in — it matches
            on <Mono>source</Mono> + <Mono>external_id</Mono> (or email) so replaying the same call
            never duplicates a contact:
          </Trans>
        </Prose>
        <Code>{`curl -X POST ${origin}/v1/crm/contacts/upsert \\
  -H "Authorization: Bearer manor_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "source": "website",
    "external_id": "form-4821",
    "first_name": "Jordan",
    "email": "jordan@example.com",
    "tags": ["Lead"]
  }'`}</Code>
      </Section>
      <Section title={<Trans>Where next</Trans>}>
        <Prose>
          <Trans>
            The REST tab is the full endpoint reference — conventions, pagination, and every route.
            AI clients can skip REST entirely and connect over MCP. Webhooks push changes to your
            servers as they happen.
          </Trans>
        </Prose>
      </Section>
    </>
  );
}

function RestReference({ origin }: { origin: string }) {
  return (
    <>
      <Prose>
        <Trans>
          Every request carries <Mono>Authorization: Bearer manor_…</Mono>. The token's scopes
          decide what it can reach.
        </Trans>
      </Prose>
      <Section title={<Trans>Errors</Trans>}>
        <Prose>
          <Trans>Failures return a JSON body with a human-readable message:</Trans>
        </Prose>
        <Code>{`{ "error": { "message": "Missing crm:write scope" } }`}</Code>
        <Table
          head={[<Trans key="c">Status</Trans>, <Trans key="m">Meaning</Trans>]}
          rows={STATUS_CODES.map((row) => [<Mono key="c">{row.code}</Mono>, row.meaning])}
        />
      </Section>
      <Section title={<Trans>Pagination</Trans>}>
        <Prose>
          <Trans>
            List endpoints take <Mono>limit</Mono> (1–100, default 50) and return{" "}
            <Mono>next_cursor</Mono>. Pass it back as <Mono>cursor</Mono> to fetch the next page; a{" "}
            <Mono>null</Mono> cursor means you have everything. Cursors are stable across writes, so
            syncs never skip or repeat rows.
          </Trans>
        </Prose>
        <Code>{`curl "${origin}/v1/crm/contacts?limit=100&cursor=eyJ…" \\
  -H "Authorization: Bearer manor_..."`}</Code>
      </Section>
      <Section title={<Trans>Idempotency</Trans>}>
        <Prose>
          <Trans>
            Every <Mono>POST</Mono> that creates data accepts an <Mono>Idempotency-Key</Mono>{" "}
            header. Retrying with the same key returns the original result instead of repeating the
            write; reusing a key with a different payload fails with <Mono>409</Mono>.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>Contacts</Trans>}>
        <EndpointTable endpoints={CONTACT_ENDPOINTS} />
      </Section>
      <Section title={<Trans>Pipelines and deals</Trans>}>
        <EndpointTable endpoints={DEAL_ENDPOINTS} />
        <Code>{`curl -X POST ${origin}/v1/crm/deals \\
  -H "Authorization: Bearer manor_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "pipeline_id": "cmf…",
    "stage_id": "cmf…",
    "title": "Water heater install — Smith",
    "value": 1450
  }'`}</Code>
      </Section>
      <Section title={<Trans>Custom modules</Trans>}>
        <Prose>
          <Trans>
            Modules are the user-defined sheets in the CRM — each one declares typed fields (text,
            number, date, checkbox, select, email, phone, URL) and holds records validated against
            them. Record <Mono>values</Mono> accept field labels or field ids as keys:
          </Trans>
        </Prose>
        <EndpointTable endpoints={MODULE_ENDPOINTS} />
        <Code>{`curl -X POST ${origin}/v1/crm/modules/cmf…/records \\
  -H "Authorization: Bearer manor_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "values": { "Name": "Jordan Ellis", "Rent": 1450, "Move-in ready": true }
  }'`}</Code>
      </Section>
      <Section title={<Trans>Webhook management</Trans>}>
        <EndpointTable endpoints={WEBHOOK_ENDPOINTS} />
        <Prose>
          <Trans>Delivery format, retries, and signatures are on the Webhooks tab.</Trans>
        </Prose>
      </Section>
      <Section title={<Trans>OpenAPI document</Trans>}>
        <Prose>
          <Trans>
            The machine-readable spec lives at <Mono>{`${origin}/v1/openapi.json`}</Mono> — import
            it into Postman, Insomnia, or a code generator to get typed clients for everything on
            this page.
          </Trans>
        </Prose>
      </Section>
    </>
  );
}

function McpReference({ origin }: { origin: string }) {
  const { t } = useLingui();
  return (
    <>
      <Prose>
        <Trans>
          {brandName} hosts an MCP server for the CRM. Any client that speaks streamable HTTP —
          Claude, agents, IDEs — gets the same tools {brandName}'s own bots use.
        </Trans>
      </Prose>
      <Section title={<Trans>Endpoint</Trans>}>
        <Code>{`${origin}/mcp/crm`}</Code>
        <Prose>
          <Trans>
            Authenticate with the same bearer token as REST. Read-only tools need{" "}
            <Mono>crm:read</Mono>; mutating tools need <Mono>crm:write</Mono>. Tools the token
            cannot use are not advertised at all.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>Connect from Claude</Trans>}>
        <Prose>
          <Trans>
            Settings → Connectors → Add custom connector. Paste the endpoint URL and the token, and
            the CRM tools appear in every conversation.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>Tools</Trans>}>
        <Table
          head={[
            <Trans key="t">Tool</Trans>,
            <Trans key="r">Arguments</Trans>,
            <Trans key="a">Access</Trans>,
          ]}
          rows={MCP_TOOLS.map((tool) => [
            <Mono key="t">{tool.name}</Mono>,
            <span key="r" className="font-mono text-[12px] text-[#85858A]">
              {tool.args}
            </span>,
            tool.writes ? t`read / write` : t`read-only`,
          ])}
        />
        <Prose>
          <Trans>
            Record tools address modules by name or id, and record <Mono>values</Mono> use field
            labels as keys — an agent can say{" "}
            <Mono>{`{"module": "Tenants", "values": {"Rent": 1450}}`}</Mono> without ever seeing an
            internal id.
          </Trans>
        </Prose>
      </Section>
    </>
  );
}

function WebhooksReference({ origin }: { origin: string }) {
  return (
    <>
      <Prose>
        <Trans>
          {brandName} pushes CRM changes to URLs you register — in Integrations → CRM API access or
          via <Mono>POST /v1/webhooks</Mono>. Each endpoint gets a signing secret, shown once.
        </Trans>
      </Prose>
      <Section title={<Trans>Register an endpoint</Trans>}>
        <Code>{`curl -X POST ${origin}/v1/webhooks \\
  -H "Authorization: Bearer manor_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "CRM sync",
    "url": "https://example.com/hooks/crm",
    "events": ["contact.created", "deal.stage_changed"]
  }'`}</Code>
        <Prose>
          <Trans>
            URLs must be HTTPS. The response includes the endpoint and its signing secret — store
            it; it cannot be retrieved again.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>Events</Trans>}>
        <div className="mb-3 flex flex-wrap gap-2">
          {WEBHOOK_EVENTS.map((event) => (
            <Mono key={event}>{event}</Mono>
          ))}
        </div>
        <Prose>
          <Trans>
            <Mono>record.*</Mono> events fire for custom module records; the payload's{" "}
            <Mono>data</Mono> carries the full object after the change.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>Delivery</Trans>}>
        <Code>{`POST <your URL>
content-type: application/json
x-manor-event: deal.stage_changed
x-manor-delivery: <delivery id>
x-manor-timestamp: <unix seconds>
x-manor-signature: v1=<hex>

{ "id": "…", "type": "deal.stage_changed", "created_at": "…", "data": { … } }`}</Code>
        <Prose>
          <Trans>
            Failed deliveries retry up to 8 times with exponential backoff, capped at one hour
            between attempts. Respond with a 2xx within 10 seconds.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>Verify the signature</Trans>}>
        <Prose>
          <Trans>
            The signature is an HMAC-SHA256 of <Mono>{"<timestamp>.<raw body>"}</Mono> using the
            endpoint's signing secret:
          </Trans>
        </Prose>
        <Code>{`const expected = "v1=" + createHmac("sha256", secret)
  .update(\`\${timestamp}.\${rawBody}\`)
  .digest("hex");
// compare with x-manor-signature using a constant-time check`}</Code>
        <Prose>
          <Trans>
            Reject deliveries whose timestamp is more than a few minutes old to block replays.
          </Trans>
        </Prose>
      </Section>
    </>
  );
}

function Table({ head, rows }: { head: React.ReactNode[]; rows: React.ReactNode[][] }) {
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[#202023]">
      <table className="w-full border-collapse bg-[#131315] text-left text-[13px]">
        <thead>
          <tr className="border-b border-[#1C1C1F]">
            {head.map((cell, index) => (
              <th key={index} className="px-4 py-2.5 font-medium text-[#85858A]">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[#1C1C1F] last:border-b-0">
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-2.5 text-[#C9C9CE]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
