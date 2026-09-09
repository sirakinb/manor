import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceAccess } from "@rakazo/contracts";
import { Ellipsis } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { BuiButton, BuiCard } from "../components/beautiful-ui/primitives";
import {
  type McpClient,
  type McpSurface,
  mcpClientSetup,
  mcpConnections,
} from "../lib/mcp-client-setup";

const CLIENTS = [
  { id: "claude", name: "Claude Code", logo: "/agent-logos/claude.svg" },
  { id: "cursor", name: "Cursor", logo: "/agent-logos/cursor.svg" },
  { id: "codex", name: "Codex", logo: "/agent-logos/codex.svg" },
] as const;

export function AgentConnectionSetup({
  origin,
  access,
}: {
  origin: string;
  access: WorkspaceAccess;
}) {
  const { t } = useLingui();
  const [client, setClient] = useState<McpClient>("claude");
  const [target, setTarget] = useState<McpSurface | "both">("crm");
  const effectiveTarget = access.workspace ? target : "crm";
  const surfaces: McpSurface[] =
    effectiveTarget === "both" ? ["crm", "workspace"] : [effectiveTarget];
  const connections = mcpConnections(origin, access.organization.id, surfaces);
  const organizationName = access.organization.name;
  const clients = [...CLIENTS, { id: "other" as const, name: t`Other`, logo: null }];

  return (
    <ol className="mt-8" aria-label={t`Agent connection setup`}>
      <SetupStep number={1} title={<Trans>Pick your AI tool</Trans>}>
        <p className="mb-4">
          <Trans>Choose your app to see its setup instructions.</Trans>
        </p>
        <fieldset className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4" aria-label={t`AI tool`}>
          {clients.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={client === option.id}
              onClick={() => setClient(option.id)}
              className={`flex min-h-28 flex-col items-center justify-center gap-3 rounded-2xl border px-3 py-5 text-[14px] font-medium transition-colors ${client === option.id ? "border-[#C9C9CE] bg-[#1B1B1E] text-[#ECECEE]" : "border-[#26262A] text-[#A8A8AD] hover:border-[#66666E]"}`}
            >
              {option.logo ? (
                <img
                  src={option.logo}
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 brightness-0 invert"
                />
              ) : (
                <Ellipsis size={28} aria-hidden />
              )}
              {option.name}
            </button>
          ))}
        </fieldset>
        {access.workspace ? (
          <fieldset className="mt-5">
            <legend className="mb-2 text-[13px] text-[#ECECEE]">
              <Trans>What should it work with?</Trans>
            </legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "crm", label: t`Contacts & deals` },
                  { id: "workspace", label: t`Shared knowledge` },
                  { id: "both", label: t`Both` },
                ] as const
              ).map((option) => (
                <label key={option.id} className="relative cursor-pointer">
                  <input
                    className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
                    type="radio"
                    name="connection-data"
                    value={option.id}
                    checked={effectiveTarget === option.id}
                    onChange={() => setTarget(option.id)}
                  />
                  <span className="pointer-events-none block rounded-full border border-[#26262A] px-3 py-1.5 text-[13px] peer-checked:border-[#85858A] peer-checked:bg-[#232326] peer-checked:text-[#ECECEE] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-[13px]">
              {effectiveTarget === "crm" ? (
                <Trans>Find contacts, add leads, and update deals in your CRM.</Trans>
              ) : effectiveTarget === "workspace" ? (
                <Trans>
                  Read shared instructions and available business data, then save findings for your
                  team.
                </Trans>
              ) : (
                <Trans>
                  Connect your CRM and shared workspace knowledge with two server entries.
                </Trans>
              )}
            </p>
          </fieldset>
        ) : null}
      </SetupStep>
      <SetupStep number={2} title={<Trans>Create an access token</Trans>}>
        <p>
          <Trans>
            With {organizationName} selected, open Integrations → API & agent access → CRM API
            access. Create a token for this agent and copy it.
          </Trans>
        </p>
        {surfaces.includes("crm") ? (
          <p className="mt-3">
            <Trans>
              Enable <code>crm:read</code> to look up records. Add <code>crm:write</code> to create
              or change them.
            </Trans>
          </p>
        ) : null}
        {surfaces.includes("workspace") ? (
          <p className="mt-3">
            <Trans>
              Enable <code>workspace:read</code> for shared knowledge. Add the workspace write
              permissions for anything the agent should save.
            </Trans>
          </p>
        ) : null}
      </SetupStep>
      <SetupStep
        number={3}
        title={
          client === "cursor" ? (
            <Trans>Add the server configuration</Trans>
          ) : client === "other" ? (
            <Trans>Add an MCP connection</Trans>
          ) : (
            <Trans>Register the server</Trans>
          )
        }
      >
        <div key={`${client}-${effectiveTarget}`} data-testid="mcp-client-instructions">
          {client === "claude" ? (
            <>
              <p className="mb-4">
                <Trans>
                  Open a terminal. Replace REPLACE_WITH_MANOR_TOKEN with your token, then run:
                </Trans>
              </p>
              <CopyableSetupCode
                label={t`Copy command`}
                value={mcpClientSetup(client, connections)}
              />
              <p className="mt-3">
                <Trans>This adds the connection to your Claude Code user settings.</Trans>
              </p>
            </>
          ) : client === "cursor" ? (
            <>
              <p className="mb-4">
                <Trans>
                  Open your global Cursor configuration at <code>~/.cursor/mcp.json</code>. Add
                  these entries to <code>mcpServers</code>, keeping any existing servers. Replace
                  REPLACE_WITH_MANOR_TOKEN with your token.
                </Trans>
              </p>
              <CopyableSetupCode
                label={t`Copy configuration`}
                value={mcpClientSetup(client, connections)}
              />
              <p className="mt-3">
                <Trans>
                  Save the file, then open Cursor’s MCP settings to check the connection.
                </Trans>
              </p>
            </>
          ) : client === "codex" ? (
            <>
              <p className="mb-4">
                <Trans>
                  In a macOS or Linux terminal, set your token. Replace the placeholder before
                  running:
                </Trans>
              </p>
              <CopyableSetupCode
                label={t`Copy token command`}
                value={"export MANOR_API_TOKEN='REPLACE_WITH_MANOR_TOKEN'"}
              />
              <p className="my-4">
                <Trans>Then register the connection:</Trans>
              </p>
              <CopyableSetupCode
                label={t`Copy command`}
                value={mcpClientSetup(client, connections)}
              />
              <p className="mt-3">
                <Trans>
                  Launch Codex from this terminal so it can read the token. Future sessions also
                  need MANOR_API_TOKEN set in their environment.
                </Trans>
              </p>
            </>
          ) : (
            <>
              <p className="mb-4">
                <Trans>In your app’s MCP settings, add an HTTP server using each URL below.</Trans>
              </p>
              {connections.map((connection) => (
                <div key={connection.name} className="mb-4">
                  <CopyableSetupCode label={t`Copy server URL`} value={connection.url} />
                </div>
              ))}
              <p className="mb-4">
                <Trans>
                  Add this authorization header, replacing the placeholder with your token:
                </Trans>
              </p>
              <CopyableSetupCode
                label={t`Copy authorization header`}
                value="Authorization: Bearer REPLACE_WITH_MANOR_TOKEN"
              />
              <p className="mt-3">
                <Trans>
                  Your app must support Streamable HTTP and custom headers. Manor uses a token here;
                  there is no browser sign-in step.
                </Trans>
              </p>
            </>
          )}
        </div>
      </SetupStep>
      <SetupStep number={4} title={<Trans>Check the connection</Trans>} last>
        <p className="mb-4">
          {client === "claude" ? (
            <Trans>
              Start a new Claude Code session and run <code>/mcp</code>. Check that the Manor server
              is connected.
            </Trans>
          ) : client === "cursor" ? (
            <Trans>
              Check that the server is enabled in Cursor’s MCP settings, then start a new agent
              chat.
            </Trans>
          ) : client === "codex" ? (
            <Trans>
              Run <code>codex</code> in the terminal where you set the token. Use <code>/mcp</code>{" "}
              to check the registered server, then start a conversation.
            </Trans>
          ) : (
            <Trans>
              Check that your app shows the connection as available, then start a new agent
              conversation.
            </Trans>
          )}
        </p>
        <BuiCard className="p-4">
          <p className="mb-2 text-[12px] font-medium text-[#ECECEE]">
            <Trans>Try this first</Trans>
          </p>
          <blockquote className="text-[#C9C9CE]">
            <Trans>
              Confirm which Manor organization you’re connected to and tell me what you can read or
              change. Don’t change anything yet.
            </Trans>
          </blockquote>
        </BuiCard>
      </SetupStep>
    </ol>
  );
}

function SetupStep({
  number,
  title,
  children,
  last = false,
}: {
  number: number;
  title: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <li className={`relative ms-4 ps-7 ${last ? "" : "border-s border-[#26262A] pb-9"}`}>
      <span
        aria-hidden
        className="absolute -start-4 top-0 grid h-8 w-8 place-items-center rounded-full bg-[#232326] text-[14px] font-medium text-[#ECECEE]"
      >
        {number}
      </span>
      <h2 className="mb-2 pt-0.5 text-[16px] font-medium text-[#ECECEE]">{title}</h2>
      <div className="min-w-0 text-[14px] leading-6 text-[#A8A8AD] [overflow-wrap:anywhere]">
        {children}
      </div>
    </li>
  );
}

function CopyableSetupCode({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <BuiCard className="min-w-0 p-4">
      <pre className="whitespace-pre-wrap font-mono text-[12px] leading-6 text-[#C9C9CE] [overflow-wrap:anywhere]">
        {value}
      </pre>
      <div className="mt-3 flex justify-end">
        <BuiButton
          onClick={() => {
            setFailed(false);
            void navigator.clipboard.writeText(value).then(
              () => setCopied(true),
              () => setFailed(true),
            );
          }}
        >
          {copied ? <Trans>Copied</Trans> : label}
        </BuiButton>
      </div>
      {failed ? (
        <p role="alert" className="mt-2 text-[13px]">
          <Trans>Could not copy. Select and copy the text above.</Trans>
        </p>
      ) : null}
    </BuiCard>
  );
}
