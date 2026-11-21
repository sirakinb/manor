import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { ScreenProxyTarget } from "@rakazo/core/node/screen-capability";
import {
  isScreenProxyTarget,
  SCREEN_RECHECK_MS,
  SCREEN_TARGET_ENDPOINT,
} from "@rakazo/core/node/screen-capability";

const SENSITIVE_FORWARD_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authenticate",
  "proxy-authorization",
]);

/** Fail closed when the authoritative lifecycle check is unavailable. */
export async function resolveNovncTarget(
  url: string | undefined,
  secret: string,
  api: string,
  onFailure?: (reason: ScreenTargetFailure) => void,
): Promise<ScreenProxyTarget | null> {
  if (!url?.startsWith("/novnc/session/")) {
    onFailure?.("invalid_path");
    return null;
  }
  try {
    const response = await fetch(new URL(SCREEN_TARGET_ENDPOINT, api), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ path: url }),
    });
    if (!response.ok) {
      onFailure?.("authority_rejected");
      return null;
    }
    let target: unknown;
    try {
      target = await response.json();
    } catch (error) {
      onFailure?.(
        error instanceof SyntaxError ? "invalid_authority_response" : "authority_unavailable",
      );
      return null;
    }
    if (isScreenProxyTarget(target)) return target;
    onFailure?.("invalid_authority_response");
    return null;
  } catch {
    onFailure?.("authority_unavailable");
    return null;
  }
}

export type ScreenTargetFailure =
  | "invalid_path"
  | "authority_rejected"
  | "invalid_authority_response"
  | "authority_unavailable";

function isHttp2PseudoHeader(key: string) {
  return key.startsWith(":");
}

export function safeProxyHeaders(headers: IncomingHttpHeaders) {
  return Object.fromEntries(
    Object.entries(headers).filter(([key, value]) => {
      return (
        value != null &&
        !isHttp2PseudoHeader(key) &&
        !SENSITIVE_FORWARD_HEADERS.has(key.toLowerCase())
      );
    }),
  );
}

/** Recheck streams as well as new requests; no positive authorization cache. */
export function watchScreenAuthorization(check: () => Promise<boolean>, revoke: () => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    let allowed = false;
    try {
      allowed = Boolean(await check());
    } catch {
      /* Fail closed. */
    }
    if (stopped) return;
    if (!allowed) {
      stopped = true;
      revoke();
      return;
    }
    timer = setTimeout(tick, SCREEN_RECHECK_MS);
    timer.unref?.();
  };
  timer = setTimeout(tick, SCREEN_RECHECK_MS);
  timer.unref?.();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// The screen proxy's response filtering lives in @rakazo/core/node/screen-proxy-response.
// App previews keep their own filter: they must not inherit the screen sandbox policy.
const SENSITIVE_PREVIEW_RESPONSE_HEADERS = new Set([
  "clear-site-data",
  "set-cookie",
  "set-cookie2",
]);

export function safeProxyResponseHeaders(headers: IncomingHttpHeaders) {
  return Object.fromEntries(
    Object.entries(headers).filter(([key, value]) => {
      return value != null && !SENSITIVE_PREVIEW_RESPONSE_HEADERS.has(key.toLowerCase());
    }),
  );
}

const PREVIEW_POLICY = "app";

export interface PreviewTarget {
  hostname: string;
  port: number;
  path: string;
  /** Proxy prefix (no trailing slash) that maps to "/" on the app, for rewriting absolute URLs. */
  prefix: string;
}

/**
 * `/preview/{host}/{port}/{expiresAt}.{sig}{path}` → an app port inside a bot
 * computer. Signed with the "app" policy; the screen proxy's view/control
 * capabilities do not validate here.
 */
export function resolvePreviewTarget(
  url: string | undefined,
  secret: string,
  now = Date.now(),
): PreviewTarget | null {
  const match = url?.match(
    /^\/preview\/([A-Za-z0-9_-]+)\/(\d+)\/(\d+)\.([A-Za-z0-9_-]{43})(\/[^?]*)?(\?.*)?$/,
  );
  if (!match) return null;
  const hostname = Buffer.from(match[1]!, "base64url").toString("utf8");
  const port = Number(match[2]);
  const expiresAt = Number(match[3]);
  const signature = match[4]!;
  if (!isAllowedTargetName(hostname)) return null;
  if (!Number.isInteger(port) || port < 1024 || port > 65_535 || expiresAt < now) return null;
  const expected = createHmac("sha256", secret)
    .update(`${hostname}:${port}:${PREVIEW_POLICY}:${expiresAt}`)
    .digest("base64url");
  const suppliedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return null;
  }
  return {
    hostname,
    port,
    path: `${match[5] || "/"}${match[6] || ""}`,
    prefix: `/preview/${match[1]}/${match[2]}/${match[3]}.${match[4]}`,
  };
}

/**
 * Apps served under the proxy prefix usually reference assets by absolute
 * path ("/assets/app.js"). Point those at the prefix and add a <base> so
 * relative references resolve under it too. Only HTML is rewritten; scripts
 * that build absolute URLs at runtime are the app's responsibility.
 */
export function rewritePreviewHtml(html: string, prefix: string): string {
  const withAttrs = html.replace(
    /(\s(?:src|href|action|poster|data-src)\s*=\s*["'])\/(?!\/)/gi,
    `$1${prefix}/`,
  );
  const withSrcset = withAttrs.replace(
    /(\ssrcset\s*=\s*["'])([^"']*)/gi,
    (_m, lead, list) => `${lead}${String(list).replace(/(^|,\s*)\/(?!\/)/g, `$1${prefix}/`)}`,
  );
  if (/<base\s/i.test(withSrcset)) return withSrcset;
  return withSrcset.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="${prefix}/">`);
}

export function rewritePreviewCss(css: string, prefix: string): string {
  return css.replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1${prefix}/`);
}

// Upstream resolves screen targets through the API now; app previews still verify
// their own signed URL here, so they keep the private target allowlist.
function isAllowedTargetName(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3})\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.(?:\d{1,3})\.\d{1,3}$/.test(hostname) ||
    /^rakazo-bot-[a-zA-Z0-9_.-]+$/.test(hostname)
  );
}
