import { t } from "@lingui/core/macro";
import { parsePastedCallback } from "./mcp-paste";
import { rpc } from "./rpc";

export const MCP_OAUTH_CHANNEL = "rakazo-mcp-oauth";
const MCP_OAUTH_TIMEOUT_MS = 2 * 60 * 1000;

export type McpOauthResult =
  | "connected"
  | "cancelled"
  | "already_connected"
  | "authorization_not_requested"
  /** The provider only accepts a loopback callback: the user pastes the address it lands on. */
  | { paste: { sessionId: string; authorizationUrl: string } };

/** Run the browser OAuth popup flow for an MCP server: request an
 * authorization URL, open the popup, and wait until the callback page
 * broadcasts completion or the popup is closed without finishing.
 *
 * The BroadcastChannel (not window.opener) is the completion signal because
 * provider login pages with COOP sever the opener link. */
export async function connectMcpOauth(serverId: string): Promise<McpOauthResult> {
  const started = await rpc.mcp.oauth.begin({
    serverId,
    redirectUri: `${window.location.origin}/mcp/oauth/callback`,
  });
  if (started.status !== "authorization_required") return started.status;
  if (started.completion === "paste") {
    window.open(started.authorizationUrl, "_blank");
    return { paste: { sessionId: started.sessionId, authorizationUrl: started.authorizationUrl } };
  }
  const popup = window.open(
    started.authorizationUrl,
    MCP_OAUTH_CHANNEL,
    "popup,width=560,height=720",
  );
  if (!popup) {
    // Popup blocked: navigate this tab instead; the callback page returns to /app.
    window.location.assign(started.authorizationUrl);
    return "cancelled";
  }
  return await new Promise<McpOauthResult>((resolve) => {
    const channel = new BroadcastChannel(MCP_OAUTH_CHANNEL);
    let settled = false;
    let pollTimer = 0;
    let timeoutTimer = 0;
    const finish = (result: McpOauthResult) => {
      if (settled) return;
      settled = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(timeoutTimer);
      channel.close();
      resolve(result);
    };
    pollTimer = window.setInterval(() => {
      if (!popup.closed) return;
      finish("cancelled");
    }, 500);
    timeoutTimer = window.setTimeout(() => {
      popup.close();
      finish("cancelled");
    }, MCP_OAUTH_TIMEOUT_MS);
    channel.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type !== "mcp-oauth-complete") return;
      finish("connected");
    };
  });
}

/** Finish a paste-back authorization from the address the browser landed on after approving. */
export async function finishMcpOauthFromPaste(sessionId: string, pasted: string): Promise<void> {
  const parsed = parsePastedCallback(sessionId, pasted);
  if (!parsed.ok) {
    if (parsed.reason === "denied") throw new Error(parsed.detail);
    throw new Error(
      parsed.reason === "not_an_address"
        ? t`Paste the full address from the page you landed on.`
        : t`That address is not from this sign-in. Start again and paste the new one.`,
    );
  }
  await rpc.mcp.oauth.complete({ sessionId, code: parsed.code, state: parsed.state });
}
