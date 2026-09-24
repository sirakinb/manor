export type PastedCallback =
  | { ok: true; code: string; state: string }
  | { ok: false; reason: "not_an_address" | "other_sign_in" }
  | { ok: false; reason: "denied"; detail: string };

/** Read the OAuth callback address a user pasted back after approving on a loopback-only provider. */
export function parsePastedCallback(sessionId: string, pasted: string): PastedCallback {
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return { ok: false, reason: "not_an_address" };
  }
  const denied = url.searchParams.get("error");
  if (denied) {
    return {
      ok: false,
      reason: "denied",
      detail: url.searchParams.get("error_description") ?? denied,
    };
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || state !== sessionId) return { ok: false, reason: "other_sign_in" };
  return { ok: true, code, state };
}
