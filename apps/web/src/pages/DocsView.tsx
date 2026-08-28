import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

type DocsTab = "start" | "rest" | "mcp" | "webhooks";

const SCOPES = [
  { scope: "crm:read", grants: "GET /v1/crm/*, read-only MCP tools" },
  { scope: "crm:write", grants: "CRM mutations over REST and MCP" },
  { scope: "webhooks:manage", grants: "/v1/webhooks" },
];

const REST_ENDPOINTS: Array<{ method: string; path: string; scope: string; idempotent?: true }> = [
  { method: "GET", path: "/v1/crm/contacts", scope: "crm:read" },
  { method: "GET", path: "/v1/crm/contacts/:id", scope: "crm:read" },
  { method: "POST", path: "/v1/crm/contacts/upsert", scope: "crm:write", idempotent: true },
  { method: "GET", path: "/v1/crm/pipelines", scope: "crm:read" },
  { method: "GET", path: "/v1/crm/deals", scope: "crm:read" },
  { method: "POST", path: "/v1/crm/deals", scope: "crm:write", idempotent: true },
  { method: "PATCH", path: "/v1/crm/deals/:id", scope: "crm:write" },
  { method: "POST", path: "/v1/crm/deals/:id/move", scope: "crm:write" },
  { method: "GET", path: "/v1/webhooks", scope: "webhooks:manage" },
  { method: "POST", path: "/v1/webhooks", scope: "webhooks:manage" },
  { method: "DELETE", path: "/v1/webhooks/:id", scope: "webhooks:manage" },
];

const MCP_TOOLS = [
  { name: "crm_overview", writes: false },
  { name: "crm_find_contacts", writes: false },
  { name: "crm_upsert_contact", writes: true },
  { name: "crm_create_deal", writes: true },
  { name: "crm_update_deal", writes: true },
  { name: "crm_move_deal", writes: true },
];

const WEBHOOK_EVENTS = [
  "contact.created",
  "contact.updated",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
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
          className="text-[13px] text-[#AEB5FF] hover:text-[#D1D5FF]"
        >
          <Trans>OpenAPI spec ↗</Trans>
        </a>
      </div>

      <div className="rk-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-[22px] py-6">
          {tab === "start" ? <GettingStarted origin={origin} /> : null}
          {tab === "rest" ? <RestReference origin={origin} /> : null}
          {tab === "mcp" ? <McpReference origin={origin} /> : null}
          {tab === "webhooks" ? <WebhooksReference /> : null}
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

function GettingStarted({ origin }: { origin: string }) {
  return (
    <>
      <Prose>
        <Trans>
          The Manor API connects websites, automation tools, and AI clients to this workspace. The
          CRM is the first surface it covers; new areas will appear here as they open up.
        </Trans>
      </Prose>
      <Section title={<Trans>Base URL</Trans>}>
        <Code>{origin}</Code>
      </Section>
      <Section title={<Trans>Create a token</Trans>}>
        <Prose>
          <Trans>
            Open Integrations → CRM API access, name the credential, pick its scopes, and copy the
            token — it is shown once. Tokens start with <Mono>manor_</Mono> and can be revoked at
            any time.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>Make a request</Trans>}>
        <Code>{`curl ${origin}/v1/crm/contacts \\
  -H "Authorization: Bearer manor_..."`}</Code>
        <Prose>
          <Trans>AI clients can skip REST entirely and connect over MCP — see the MCP tab.</Trans>
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
      <Section title={<Trans>Scopes</Trans>}>
        <Table
          head={[<Trans key="s">Scope</Trans>, <Trans key="g">Grants</Trans>]}
          rows={SCOPES.map((row) => [<Mono key="s">{row.scope}</Mono>, row.grants])}
        />
      </Section>
      <Section title={<Trans>Endpoints</Trans>}>
        <Table
          head={[
            <Trans key="m">Method</Trans>,
            <Trans key="p">Path</Trans>,
            <Trans key="s">Scope</Trans>,
          ]}
          rows={REST_ENDPOINTS.map((row) => [
            <span key="m" className="font-mono text-[12px] text-[#8AB7FF]">
              {row.method}
            </span>,
            <span key="p" className="font-mono text-[12px]">
              {row.path}
              {row.idempotent ? " *" : ""}
            </span>,
            <Mono key="s">{row.scope}</Mono>,
          ])}
        />
        <Prose>
          <Trans>
            * accepts an <Mono>idempotency-key</Mono> header: retrying with the same key returns the
            original result instead of repeating the write.
          </Trans>
        </Prose>
        <Prose>
          <Trans>
            Request and response shapes live in the OpenAPI document at{" "}
            <Mono>{`${origin}/v1/openapi.json`}</Mono>.
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
          Manor hosts an MCP server for the CRM. Any client that speaks streamable HTTP — Claude,
          agents, IDEs — gets the same tools Manor's own bots use.
        </Trans>
      </Prose>
      <Section title={<Trans>Endpoint</Trans>}>
        <Code>{`${origin}/mcp/crm`}</Code>
        <Prose>
          <Trans>
            Authenticate with the same bearer token as REST. Read-only tools need{" "}
            <Mono>crm:read</Mono>; mutating tools need <Mono>crm:write</Mono>.
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
          head={[<Trans key="t">Tool</Trans>, <Trans key="a">Access</Trans>]}
          rows={MCP_TOOLS.map((tool) => [
            <Mono key="t">{tool.name}</Mono>,
            tool.writes ? t`read / write` : t`read-only`,
          ])}
        />
      </Section>
    </>
  );
}

function WebhooksReference() {
  return (
    <>
      <Prose>
        <Trans>
          Manor pushes CRM changes to URLs you register — in Integrations → CRM API access or via{" "}
          <Mono>POST /v1/webhooks</Mono>. Each endpoint gets a signing secret, shown once.
        </Trans>
      </Prose>
      <Section title={<Trans>Events</Trans>}>
        <div className="mb-3 flex flex-wrap gap-2">
          {WEBHOOK_EVENTS.map((event) => (
            <Mono key={event}>{event}</Mono>
          ))}
        </div>
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
