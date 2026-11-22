import type { Hono } from "hono";

/** Package of the Rakazo Android app (apps/mobile/app.json). */
const ANDROID_PACKAGE = "com.rakazo.app";

/**
 * Manor: the relying party a request may use, or null where passkeys cannot work. A browser
 * ceremony only succeeds on the relying-party host or its subdomains, so brand portals on
 * their own domains get none. The page's origin decides; a same-origin request carries none,
 * so its Host does. Native apps send their own scheme and use the relying party's
 * associated domain wherever they connect.
 */
export function passkeyRpIdForRequest(passkeyRpId: string | null, headers: Headers) {
  if (!passkeyRpId) return null;
  const origin = headers.get("origin");
  let hostname: string | undefined;
  if (origin) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return passkeyRpId;
    hostname = url.hostname;
  } else {
    hostname = headers.get("host")?.replace(/:\d+$/, "");
  }
  if (!hostname) return null;
  hostname = hostname.toLowerCase();
  const rpId = passkeyRpId.toLowerCase();
  return hostname === rpId || hostname.endsWith(`.${rpId}`) ? passkeyRpId : null;
}

/**
 * Which native apps can use this server's passkeys: only those the domain vouches for
 * below. Without the association file the OS refuses every ceremony, so apps hide passkeys.
 */
export function nativePasskeys(
  env: { passkeyAppleAppIds: string[]; passkeyAndroidCertFingerprints: string[] },
  passkeyRpId: string | null,
): { ios: boolean; android: boolean } {
  return {
    ios: Boolean(passkeyRpId) && env.passkeyAppleAppIds.length > 0,
    android: Boolean(passkeyRpId) && env.passkeyAndroidCertFingerprints.length > 0,
  };
}

/** Each association file exists only when the deployment names its apps. */
export function mountAppAssociation(
  app: Hono,
  env: { passkeyAppleAppIds: string[]; passkeyAndroidCertFingerprints: string[] },
) {
  app.get("/.well-known/apple-app-site-association", (c) => {
    if (!env.passkeyAppleAppIds.length) return c.notFound();
    return c.json({ webcredentials: { apps: env.passkeyAppleAppIds } });
  });
  app.get("/.well-known/assetlinks.json", (c) => {
    if (!env.passkeyAndroidCertFingerprints.length) return c.notFound();
    return c.json([
      {
        relation: ["delegate_permission/common.get_login_creds"],
        target: {
          namespace: "android_app",
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: env.passkeyAndroidCertFingerprints,
        },
      },
    ]);
  });
}
