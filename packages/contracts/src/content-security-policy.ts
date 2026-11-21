/**
 * Content-Security-Policy for documents the web server (and the desktop bundled renderer) serves.
 * The app talks only to its own origin: /api, /rpc, the Sentry tunnel and the /novnc screen proxy
 * all live there, so 'self' covers fetches, WebSockets and screen frames in every deployment. The
 * web server may add operator-configured https origins for a script its CDN injects.
 */

/** Static shell for SandboxedHtmlViewer. It must load from the network so it does not inherit the
 * app policy the way a srcdoc frame would; its own meta CSP governs it and its nested preview. */
export const HTML_VIEWER_PATH = "/html-viewer.html";

/** Same-origin endpoint browsers send violation reports to, so a blocked resource is not silent. */
export const CSP_REPORT_PATH = "/api/csp-report";
const CSP_REPORT_GROUP = "csp";

/** The `Reporting-Endpoints` header that names the policy's `report-to` group. */
export const CSP_REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;

// Manor: the web app's index.html loads Geist and Fraunces from Google Fonts.
const MANOR_STYLE_SOURCES = ["https://fonts.googleapis.com"];
const MANOR_FONT_SOURCES = ["https://fonts.gstatic.com"];

const APP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  // Mermaid SVGs and some UI libraries inject <style> elements and style attributes as markup.
  "style-src": ["'self'", "'unsafe-inline'", ...MANOR_STYLE_SOURCES],
  // Markdown images, link favicons and attachment previews (object URLs).
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'", "data:", ...MANOR_FONT_SOURCES],
  // Voice replies and video attachments play from object URLs.
  "media-src": ["'self'", "blob:"],
  "connect-src": ["'self'"],
  // The /novnc screen proxy, the HTML viewer shell and PDF object URLs.
  "frame-src": ["'self'", "blob:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  // Browsers with the Reporting API use report-to and ignore report-uri; the rest use report-uri.
  "report-uri": [CSP_REPORT_PATH],
  "report-to": [CSP_REPORT_GROUP],
};

function serialize(directives: Record<string, string[]>) {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/** Origins an operator adds for a script a CDN in front of the app injects, such as analytics. */
export interface ContentSecurityPolicyExtensions {
  scriptSrc?: readonly string[];
  connectSrc?: readonly string[];
  /** Manor: origins pages may frame; see primaryOriginFrameSources. */
  frameSrc?: readonly string[];
}

// An https origin with an optional port and no path. A wildcard covers subdomains of a base with at
// least two labels (https://*.example.com), so it cannot cover a whole top-level domain.
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const EXTRA_SOURCE = new RegExp(
  `^https://(?:\\*\\.${LABEL}(?:\\.${LABEL})+|${LABEL}(?:\\.${LABEL})*)(?::(\\d{1,5}))?$`,
  "i",
);

function validSource(source: string) {
  const match = EXTRA_SOURCE.exec(source);
  const port = match?.[1];
  return Boolean(match) && (port === undefined || (Number(port) >= 1 && Number(port) <= 65535));
}

/**
 * Parses an operator's space- or comma-separated list of extra origins. Anything but an https
 * origin throws, so a typo cannot widen the policy to a keyword, a scheme or every host.
 */
export function parseContentSecuritySources(setting: string, value: string | undefined) {
  const sources = (value ?? "").split(/[\s,]+/).filter(Boolean);
  const invalid = sources.filter((source) => !validSource(source));
  if (invalid.length > 0) {
    throw new Error(
      `${setting} accepts only https:// origins such as https://cdn.example.com or https://*.example.com. Invalid: ${invalid.join(" ")}`,
    );
  }
  return [...new Set(sources.map((source) => source.toLowerCase()))];
}

export function appContentSecurityPolicy(extensions: ContentSecurityPolicyExtensions = {}) {
  return serialize({
    ...APP_DIRECTIVES,
    "script-src": ["'self'", ...(extensions.scriptSrc ?? [])],
    "connect-src": ["'self'", ...(extensions.connectSrc ?? [])],
    "frame-src": [...(APP_DIRECTIVES["frame-src"] ?? []), ...(extensions.frameSrc ?? [])],
  });
}

// Manor: brand portals are served on hosts other than WEB_ORIGIN, but the API links app previews
// (/preview/...) to WEB_ORIGIN so bot-served preview code stays cross-origin to the portal page.
// Those pages may frame exactly that origin, and nothing else is widened.

/**
 * Parses the deployment's primary web origin (WEB_ORIGIN). Only an exact http(s) origin is
 * accepted: no path, query, credentials or wildcard, so a typo cannot widen frame-src.
 */
export function parsePrimaryWebOrigin(setting: string, value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return undefined;
  let parsed: URL | undefined;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = undefined;
  }
  const valid =
    parsed &&
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    // Hostname characters only: the URL parser would keep `;` or `,` and so inject a directive.
    /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?\/?$/i.test(raw) &&
    raw.replace(/\/$/, "").toLowerCase() === parsed.origin.toLowerCase();
  if (!valid || !parsed) {
    throw new Error(
      `${setting} must be an exact http(s) origin such as https://app.example.com. Invalid: ${raw}`,
    );
  }
  return parsed.origin;
}

/** The frame sources a page served on `pageHost` adds: the primary origin, unless it is that host. */
export function primaryOriginFrameSources(
  primaryOrigin: string | undefined,
  pageHost: string | undefined,
): string[] {
  if (!primaryOrigin) return [];
  if (pageHost && new URL(primaryOrigin).host === pageHost.toLowerCase()) return [];
  return [primaryOrigin];
}

export const APP_CONTENT_SECURITY_POLICY = appContentSecurityPolicy();

// The shell's meta CSP cannot restrict framing; only the app may embed it.
const HTML_VIEWER_CONTENT_SECURITY_POLICY = serialize({ "frame-ancestors": ["'self'"] });

// Proxied responses keep their own headers; the screen proxy sets its own sandbox policy.
// Manor: /preview proxies a bot's app into the Shell's preview iframe, so it must not be stamped
// with the app policy (frame-ancestors 'none' would refuse the frame).
const PASSTHROUGH_PREFIXES = ["/api", "/rpc", "/novnc", "/preview"];

/** The policy header for a served path, or null when the response must keep its own policy. */
export function contentSecurityPolicyFor(
  pathname: string,
  appPolicy = APP_CONTENT_SECURITY_POLICY,
): string | null {
  if (
    PASSTHROUGH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  )
    return null;
  if (pathname === HTML_VIEWER_PATH) return HTML_VIEWER_CONTENT_SECURITY_POLICY;
  return appPolicy;
}
