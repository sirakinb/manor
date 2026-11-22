import { t as translate } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@rakazo/ui-web";
import { useId, useState } from "react";
import { parsePastedCallback } from "../../lib/mcp-paste";
import { rpc } from "../../lib/query/rpc";

export type McpOAuthPaste = { sessionId: string; authorizationUrl: string };

/** Finish a paste-back authorization from the address the browser landed on after approving.
 * It lives with the form, so the startup bundle carries none of it. */
async function finishMcpOauthFromPaste(sessionId: string, pasted: string): Promise<void> {
  const parsed = parsePastedCallback(sessionId, pasted);
  if (!parsed.ok) {
    if (parsed.reason === "denied") throw new Error(parsed.detail);
    throw new Error(
      parsed.reason === "not_an_address"
        ? translate`Paste the full address from the page you landed on.`
        : translate`That address is not from this sign-in. Start again and paste the new one.`,
    );
  }
  await rpc.mcp.oauth.complete({ sessionId, code: parsed.code, state: parsed.state });
}

/**
 * Manor: a provider that only accepts a loopback callback is finished by pasting the address the
 * browser lands on after approving.
 */
export function McpOAuthPasteForm({
  paste,
  onFinished,
  onCancel,
  onError,
}: {
  paste: McpOAuthPaste;
  onFinished: () => Promise<void> | void;
  onCancel: () => void;
  /** Called with the failure; the form stays open so the person can paste again. */
  onError: (error: unknown) => void;
}) {
  const { t } = useLingui();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function finish() {
    if (busy) return;
    setBusy(true);
    try {
      await finishMcpOauthFromPaste(paste.sessionId, value);
    } catch (error) {
      setBusy(false);
      onError(error);
      return;
    }
    await onFinished();
  }

  return (
    <div
      data-testid="mcp-oauth-paste"
      className="mt-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      <p className="text-label text-muted-foreground">
        <Trans>
          After you approve, your browser lands on a page that won't load. Copy that page's address
          and paste it here.
        </Trans>
      </p>
      <a
        href={paste.authorizationUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-label text-primary hover:underline"
      >
        <Trans>Open the sign-in page again</Trans>
      </a>
      <Input
        id={inputId}
        aria-label={t`Address after approving`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="http://127.0.0.1:53682/mcp/oauth/callback?code=…"
        className="mt-2 text-label"
      />
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || !value.trim()}
          onClick={() => void finish()}
        >
          {busy ? t`Connecting…` : t`Finish connecting`}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </div>
  );
}
