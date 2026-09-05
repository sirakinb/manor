import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { BuiButton } from "../components/beautiful-ui/primitives";
import { buildAgentSetupPrompt } from "../lib/agent-setup-prompt";
import {
  CONTACT_ENDPOINTS,
  DEAL_ENDPOINTS,
  type Endpoint,
  MCP_TOOLS,
  MODULE_ENDPOINTS,
  SCOPES,
  STATUS_CODES,
  WEBHOOK_ENDPOINTS,
  WEBHOOK_EVENTS,
  WORKSPACE_ENDPOINTS,
  WORKSPACE_MCP_TOOLS,
} from "../lib/api-catalog";
import { brandName } from "../lib/brand";

type DocsTab = "start" | "workspace" | "rest" | "mcp" | "webhooks";

/** The Manor API reference. The CRM is the first surface; new areas add tabs here. */
export function DocsView() {
  const { t } = useLingui();
  const [tab, setTab] = useState<DocsTab>("start");
  const origin = window.location.origin;

  const tabs: Array<{ key: DocsTab; label: string }> = [
    { key: "start", label: t`Getting started` },
    { key: "workspace", label: t`Workspace` },
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
          {tab === "workspace" ? <WorkspaceReference origin={origin} /> : null}
          {tab === "rest" ? <RestReference origin={origin} /> : null}
          {tab === "mcp" ? <McpReference origin={origin} /> : null}
          {tab === "webhooks" ? <WebhooksReference origin={origin} /> : null}
        </div>
      </div>
    </div>
  );
}

function WorkspaceReference({ origin }: { origin: string }) {
  return (
    <>
      <Section title={<Trans>Bring context into another agent platform</Trans>}>
        <Prose>
          <Trans>
            Use the Workspace MCP endpoint with any client that supports Streamable HTTP and a
            bearer token. Create a named token in Integrations → API & agent access. Give it
            workspace:read, then enable only the write scopes it needs. The token stays bound to its
            organization and its creator’s membership.
          </Trans>
        </Prose>
        <Code>{`${origin}/mcp/workspace\nAuthorization: Bearer <token>`}</Code>
        <Prose>
          <Trans>
            For a client that cannot supply bearer headers, use its HTTP/API integration instead.
            This endpoint does not provide an OAuth sign-in flow.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>Read → work → write back</Trans>}>
        <ol className="mb-4 list-decimal space-y-2 pl-5 text-[13px] leading-6 text-[#A8A8AD]">
          <li>
            <Trans>
              Start with workspace_overview. Read workspace_get_context and workspace_list_skills,
              then workspace_get_skill for the playbooks you need.
            </Trans>
          </li>
          <li>
            <Trans>
              Check workspace_activities before repeating work. Read the relevant voice, email,
              social, leasing, utilities or report data and check its timestamps.
            </Trans>
          </li>
          <li>
            <Trans>
              Do the work in Manor or your external platform using that platform’s authorized tools.
              Stored playbooks are reference material; old commands and hosts do not grant access.
            </Trans>
          </li>
          <li>
            <Trans>
              Save durable findings with workspace_set_context and reusable work with
              workspace_save_skill. Log the outcome and artifact links with workspace_log_activity
              so the next agent can pick up where you stopped.
            </Trans>
          </li>
        </ol>
        <Code>{`workspace_set_context({\n  "key": "reporting-conventions",\n  "content": "Use calendar-month totals and cite the data window.",\n  "expectedUpdatedAt": null\n})\n\nworkspace_save_skill({\n  "name": "monthly-analysis",\n  "kind": "skill",\n  "content": "Read the current report and compare the prior month…",\n  "expectedVersion": 0\n})\n\nworkspace_log_activity({\n  "channel": "email",\n  "title": "Campaign analysis completed",\n  "summary": "Reviewed the current reporting window; findings saved in the analysis document.",\n  "status": "completed",\n  "idempotencyKey": "external-platform:run-42:analysis",\n  "evidence": {\n    "platform": "external-platform",\n    "runId": "run-42",\n    "artifacts": [{"label": "Analysis", "url": "https://example.com/analysis"}]\n  }\n})`}</Code>
      </Section>
      <Section title={<Trans>Updates, retries and review</Trans>}>
        <Prose>
          <Trans>
            Use null or version 0 only for a new entry. To update context, pass its last-read
            updatedAt as expectedUpdatedAt. To save a skill version, pass its last-read version as
            expectedVersion. A 409 means someone changed the content: read it again and reconcile
            before saving. Skill versions preserve history.
          </Trans>
        </Prose>
        <Prose>
          <Trans>
            Activity writes require a stable idempotencyKey per action. Repeating the same payload
            returns the existing record; changing it with the same key returns 409. Log corrections
            as new records. The server identifies the token or bot that wrote the note.
          </Trans>
        </Prose>
        <Prose>
          <Trans>
            Completed and failed describe the agent’s reported outcome. Needs review, approved and
            rejected refer to review of that record; they do not authorize execution or undo work.
            External notes start pending review and cannot approve themselves.
          </Trans>
        </Prose>
        <Prose>
          <Trans>
            Shared workspace context and skills are live and available to both internal and external
            agents through these tools. Personal memory and bot skills created by the earlier
            conversion are independent copies; updating shared knowledge does not overwrite those
            edits or deletions.
          </Trans>
        </Prose>
      </Section>
      <Section title={<Trans>Available tools</Trans>}>
        <Table
          head={[
            <Trans key="tool">Tool</Trans>,
            <Trans key="args">Arguments</Trans>,
            <Trans key="scope">Scope</Trans>,
          ]}
          rows={WORKSPACE_MCP_TOOLS.map((tool) => [
            <span key="name">
              <Mono>{tool.name}</Mono>
              <span className="mt-2 block text-[12px] text-[#939A9E]">{tool.summary}</span>
            </span>,
            <span key="args" className="text-[12px]">
              {tool.args}
            </span>,
            <Mono key="scope">{tool.scope}</Mono>,
          ])}
        />
      </Section>
      <Section title={<Trans>Call the same tools over HTTP</Trans>}>
        <Prose>
          <Trans>
            GET /v1/workspace/tools lists the tools your token can use, including their JSON
            schemas. POST a JSON argument object to the tool’s path below. Read tools also use POST
            so MCP and HTTP take the same arguments. Use an empty object when no arguments are
            needed.
          </Trans>
        </Prose>
        <Code>{`curl "${origin}/v1/workspace/tools/workspace_get_context" \\\n  -H "Authorization: Bearer $MANOR_API_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{}'`}</Code>
        <EndpointTable endpoints={WORKSPACE_ENDPOINTS} />
      </Section>
      <Section title={<Trans>Migration boundaries</Trans>}>
        <Prose>
          <Trans>
            The Workspace endpoint covers the operations and knowledge tools listed here. Report
            sending, charge posting, automation execution, Twilio SMS, Retell agent updates, and the
            original intake, cases and SEO tools are not exposed through this endpoint. A stored
            credential or imported playbook does not make those actions available. Existing external
            platforms must be reconfigured to this endpoint; old tokens and URLs are not redirected.
          </Trans>
        </Prose>
      </Section>
    </>
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
          CRM changes back to you. External agents can also read workspace operations and context,
          save reusable skills, and write results back into the same activity history used in Manor.
        </Trans>
      </Prose>
      <Section title={<Trans>Set up with an AI agent</Trans>}>
        <Prose>
          <Trans>
            Copy this prompt into Claude, Cursor, or any coding agent along with a token — it
            connects over MCP and verifies the connection itself. Tokens live at the top of
            Integrations, under API & agent access.
          </Trans>
        </Prose>
        <CopyPromptButton prompt={buildAgentSetupPrompt({ origin })} />
      </Section>
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
            At the top of Integrations, open API & agent access → CRM API access, name the
            credential, pick its scopes, and copy the token — it is shown once. Tokens start with{" "}
            <Mono>manor_</Mono> and can be revoked at any time.
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

function CopyPromptButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="rk-setup-prompt">
      <BuiButton
        tone="accent"
        onClick={() => {
          void navigator.clipboard.writeText(prompt).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          });
        }}
      >
        {copied ? <Trans>Copied</Trans> : <Trans>Copy setup prompt</Trans>}
      </BuiButton>
    </span>
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
      <Section title={<Trans>Workspace MCP</Trans>}>
        <Code>{`${origin}/mcp/workspace`}</Code>
        <Prose>
          <Trans>
            Read operations and shared knowledge, then save context, skill versions and activity
            evidence. Choose the Workspace tab for tools, scopes and a complete read–work–write
            example. CRM tokens need workspace scopes added through a new token before they can use
            these tools.
          </Trans>
        </Prose>
      </Section>
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
      <Section title={<Trans>Connect a coding agent</Trans>}>
        <Prose>
          <Trans>
            Copy this prompt into Claude, Cursor, or any coding agent along with a token — it
            connects over MCP and verifies the connection itself.
          </Trans>
        </Prose>
        <CopyPromptButton prompt={buildAgentSetupPrompt({ origin })} />
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
          {brandName} pushes CRM changes to URLs you register — in Integrations → API & agent access
          or via <Mono>POST /v1/webhooks</Mono>. Each endpoint gets a signing secret, shown once.
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
      <Section title={<Trans>Inbound: trigger a bot</Trans>}>
        <Prose>
          <Trans>
            Webhooks also flow the other way — every bot has an inbound URL that external services
            can POST to. The payload arrives as a message and any routine with a webhook trigger
            runs, so the bot can act on it with its tools. Set it up in the bot's routine editor.
          </Trans>
        </Prose>
        <Code>{`curl -X POST ${origin}/api/v1/bots/<bot id>/webhook \\
  -H "Authorization: Bearer <webhook key>" \\
  -H "Content-Type: application/json" \\
  -d '{ "event": "booking.created", "attendee": "Jordan Ellis" }'`}</Code>
        <Prose>
          <Trans>
            Senders that cannot set headers (cal.com, form builders) can append the key to the URL
            instead: <Mono>{"?token=<webhook key>"}</Mono>. Bodies are limited to 64 KB; a{" "}
            <Mono>text</Mono> field is delivered verbatim, anything else is passed as JSON. Repeat
            deliveries with the same <Mono>Idempotency-Key</Mono> header (or payload <Mono>id</Mono>
            /<Mono>event_id</Mono>) are deduplicated.
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
