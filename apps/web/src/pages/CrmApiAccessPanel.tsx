import { Trans, useLingui } from "@lingui/react/macro";
import { INTEGRATION_SCOPES } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { BuiButton, BuiCard, SuccessPop } from "../components/beautiful-ui/primitives";
import { buildAgentSetupPrompt } from "../lib/agent-setup-prompt";
import { brandName } from "../lib/brand";
import { withSpaceHeaders } from "../lib/rpc";
import { useWorkspaceAccess } from "../lib/use-workspace-access";

type Credential = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
};

type Webhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
};

const ALL_SCOPES = INTEGRATION_SCOPES;
const DEFAULT_EVENTS = ["contact.created", "contact.updated"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: withSpaceHeaders({ "content-type": "application/json", ...init?.headers }),
  });
  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body ? body.error?.message : undefined;
    throw new Error(message ?? "Integration request failed");
  }
  return body as T;
}

export function CrmApiAccessPanel() {
  const { t } = useLingui();
  const { access, failed: accessFailed, retry: retryAccess } = useWorkspaceAccess();
  const organizationName = access?.organization.name;
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [name, setName] = useState("Website sync");
  const [scopes, setScopes] = useState<string[]>(["crm:read", "crm:write"]);
  const [webhookName, setWebhookName] = useState("CRM updates");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [revealedScopes, setRevealedScopes] = useState<string[]>([]);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [credentialResult, webhookResult] = await Promise.all([
      api<{ data: Credential[] }>("/v1/integration-credentials"),
      api<{ data: Webhook[] }>("/v1/webhooks"),
    ]);
    setCredentials(credentialResult.data);
    setWebhooks(webhookResult.data);
  }

  useEffect(() => {
    void refresh().catch((reason) =>
      setError(reason instanceof Error ? reason.message : t`Could not load API access`),
    );
  }, []);

  async function createCredential() {
    setBusy("credential");
    setError(null);
    try {
      const created = await api<Credential & { token: string }>("/v1/integration-credentials", {
        method: "POST",
        body: JSON.stringify({ name, scopes }),
      });
      setRevealedToken(created.token);
      setRevealedScopes(created.scopes);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t`Could not create credential`);
    } finally {
      setBusy(null);
    }
  }

  async function revokeCredential(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/v1/integration-credentials/${id}`, { method: "DELETE" });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t`Could not revoke credential`);
    } finally {
      setBusy(null);
    }
  }

  async function createWebhook() {
    setBusy("webhook");
    setError(null);
    try {
      const created = await api<Webhook & { signing_secret: string }>("/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({ name: webhookName, url: webhookUrl, events: DEFAULT_EVENTS }),
      });
      setRevealedSecret(created.signing_secret);
      setWebhookUrl("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t`Could not create webhook`);
    } finally {
      setBusy(null);
    }
  }

  async function removeWebhook(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/v1/webhooks/${id}`, { method: "DELETE" });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t`Could not remove webhook`);
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string, kind: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1_500);
  }

  return (
    <div className="space-y-6">
      {accessFailed ? (
        <div role="alert" className="text-sm text-[#85858A]">
          <p>
            <Trans>Could not load organization access.</Trans>
          </p>
          <BuiButton onClick={retryAccess}>
            <Trans>Retry</Trans>
          </BuiButton>
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-5">
        <div>
          <h2 className="text-lg font-medium text-[#ECECEE]">
            <Trans>CRM API access</Trans>
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#85858A]">
            {organizationName ? (
              <Trans>Tokens created here access {organizationName} only.</Trans>
            ) : null}
          </p>
        </div>
        <a href="/app/docs" className="text-sm text-[#D8B4FE] hover:text-[#E9D5FF]">
          <Trans>Documentation ↗</Trans>
        </a>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[#E1787A]">
          {error}
        </p>
      ) : null}

      <BuiCard className="space-y-4 p-5">
        <div>
          <h3 className="font-medium text-[#ECECEE]">
            <Trans>Machine credentials</Trans>
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#85858A]">
            <Trans>
              Tokens are shown once. Store them in your server or automation platform, never browser
              code.
            </Trans>
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            aria-label={t`Credential name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-xl border border-[#2C2C30] bg-[#101012] px-3 py-2.5 text-sm text-[#ECECEE] outline-none"
          />
          <BuiButton
            tone="accent"
            disabled={busy === "credential" || !name.trim() || scopes.length === 0}
            onClick={() => void createCredential()}
          >
            {busy === "credential" ? <Trans>Creating…</Trans> : <Trans>Create token</Trans>}
          </BuiButton>
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">
            <Trans>Credential scopes</Trans>
          </legend>
          {ALL_SCOPES.filter((scope) => access?.workspace || !scope.startsWith("workspace:")).map(
            (scope) => {
              const selected = scopes.includes(scope);
              return (
                <button
                  key={scope}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setScopes((current) =>
                      selected ? current.filter((value) => value !== scope) : [...current, scope],
                    )
                  }
                  className={`rounded-full border px-3 py-1.5 font-mono text-xs ${
                    selected
                      ? "border-[#A855F7] bg-[#A855F722] text-[#E9D5FF]"
                      : "border-[#34343B] text-[#85858A]"
                  }`}
                >
                  {scope}
                </button>
              );
            },
          )}
        </fieldset>
        {revealedToken ? (
          <div className="rounded-xl border border-[#3DBB7255] bg-[#3DBB7212] p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-[#8BD7AA]">
                <Trans>Copy this token now</Trans>
              </span>
              <button
                type="button"
                aria-label={t`Copy integration token`}
                onClick={() => void copy(revealedToken, "token")}
                className="text-xs text-[#C7CCFF]"
              >
                <Trans>Copy</Trans>
              </button>
            </div>
            <code className="block break-all text-xs text-[#ECECEE]">{revealedToken}</code>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#3DBB7233] pt-4">
              <BuiButton
                tone="accent"
                aria-label={t`Copy agent setup prompt with this token`}
                disabled={!access}
                onClick={() =>
                  access &&
                  void copy(
                    buildAgentSetupPrompt({
                      origin: window.location.origin,
                      token: revealedToken,
                      access,
                      scopes: revealedScopes,
                    }),
                    "prompt",
                  )
                }
              >
                {copied === "prompt" ? (
                  <Trans>Prompt copied</Trans>
                ) : (
                  <Trans>Connect an agent</Trans>
                )}
              </BuiButton>
              <p className="min-w-0 flex-1 text-xs leading-5 text-[#85858A]">
                <Trans>
                  One paste into Claude, Cursor, or any coding agent — token included, it connects
                  over MCP and verifies itself.
                </Trans>
              </p>
            </div>
            {copied === "token" ? (
              <div className="mt-3">
                <SuccessPop label={t`Copied`} />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-2">
          {credentials
            .filter((credential) => !credential.revoked_at)
            .map((credential) => (
              <div
                key={credential.id}
                className="flex items-center gap-3 rounded-xl bg-[#101012] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[#ECECEE]">{credential.name}</div>
                  <div className="mt-0.5 truncate font-mono text-xs text-[#707077]">
                    {credential.token_prefix} · {credential.scopes.join(", ")}
                  </div>
                </div>
                <BuiButton
                  disabled={busy === credential.id}
                  onClick={() => void revokeCredential(credential.id)}
                >
                  {busy === credential.id ? <Trans>Revoking…</Trans> : <Trans>Revoke</Trans>}
                </BuiButton>
              </div>
            ))}
        </div>
      </BuiCard>

      <BuiCard className="space-y-4 p-5">
        <div>
          <h3 className="font-medium text-[#ECECEE]">
            <Trans>Outbound webhooks</Trans>
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#85858A]">
            <Trans>
              {brandName} signs contact events and retries failed deliveries automatically.
            </Trans>
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[.7fr_1.3fr_auto]">
          <input
            aria-label={t`Webhook name`}
            value={webhookName}
            onChange={(event) => setWebhookName(event.target.value)}
            className="rounded-xl border border-[#2C2C30] bg-[#101012] px-3 py-2.5 text-sm text-[#ECECEE] outline-none"
          />
          <input
            aria-label={t`Webhook HTTPS URL`}
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder="https://example.com/hooks/manor"
            className="rounded-xl border border-[#2C2C30] bg-[#101012] px-3 py-2.5 text-sm text-[#ECECEE] outline-none"
          />
          <BuiButton
            tone="accent"
            disabled={busy === "webhook" || !webhookName.trim() || !webhookUrl.trim()}
            onClick={() => void createWebhook()}
          >
            {busy === "webhook" ? <Trans>Adding…</Trans> : <Trans>Add webhook</Trans>}
          </BuiButton>
        </div>
        {revealedSecret ? (
          <div className="rounded-xl border border-[#3DBB7255] bg-[#3DBB7212] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[#8BD7AA]">
                <Trans>Copy the signing secret now</Trans>
              </span>
              <button
                type="button"
                aria-label={t`Copy webhook signing secret`}
                onClick={() => void copy(revealedSecret, "secret")}
                className="text-xs text-[#C7CCFF]"
              >
                <Trans>Copy</Trans>
              </button>
            </div>
            <code className="block break-all text-xs text-[#ECECEE]">{revealedSecret}</code>
            {copied === "secret" ? (
              <div className="mt-3">
                <SuccessPop label={t`Copied`} />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-2">
          {webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className="flex items-center gap-3 rounded-xl bg-[#101012] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[#ECECEE]">{webhook.name}</div>
                <div className="mt-0.5 truncate text-xs text-[#707077]">{webhook.url}</div>
              </div>
              <BuiButton
                disabled={busy === webhook.id}
                onClick={() => void removeWebhook(webhook.id)}
              >
                {busy === webhook.id ? <Trans>Removing…</Trans> : <Trans>Remove</Trans>}
              </BuiButton>
            </div>
          ))}
        </div>
      </BuiCard>

      <BuiCard className="p-5">
        <h3 className="font-medium text-[#ECECEE]">
          <Trans>Hosted MCP</Trans>
        </h3>
        <p className="mt-1 text-xs leading-5 text-[#85858A]">
          <Trans>Give an MCP client a token with CRM scopes and connect it to this endpoint.</Trans>
        </p>
        <code className="mt-3 block rounded-xl bg-[#101012] px-4 py-3 text-xs text-[#C7CCFF]">
          {window.location.origin}/mcp/crm
        </code>
      </BuiCard>
    </div>
  );
}
