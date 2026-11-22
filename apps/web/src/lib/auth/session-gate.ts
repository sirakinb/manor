import { jitterMs } from "@rakazo/core";

export interface SessionGateInput {
  data: { user?: unknown } | null | undefined;
  isPending: boolean;
  error: { status?: number } | null;
}

export type SessionGate = "loading" | "unreachable" | "authenticated" | "anonymous";

/**
 * A failed session fetch is not a sign-out. Better Auth keeps the last known
 * session on a network error, but a cold load has nothing to keep, and its
 * refresh manager only polls once a session exists — so a request that fails
 * before the first success never retries. Routing that state to sign-in signs
 * out a user whose cookie is still valid, so it is reported separately.
 */
export function sessionGate(session: SessionGateInput): SessionGate {
  if (session.data?.user) return "authenticated";
  if (session.isPending) return "loading";
  // 401 is the server answering: there is genuinely no session.
  if (session.error && session.error.status !== 401) return "unreachable";
  return "anonymous";
}

/** The public shared-page route, which anyone holding the link may open. */
export function isPublicPagePath(pathname: string): boolean {
  return pathname.startsWith("/p/");
}

/**
 * A shared page renders whatever the visitor's session: on a host whose portal check refuses
 * the session, the lookup fails, and that page is shown signed out instead of the reconnect
 * screen. Every other route keeps the gate as it is.
 */
export function gateForPath(gate: SessionGate, pathname: string): SessionGate {
  return gate === "unreachable" && isPublicPagePath(pathname) ? "anonymous" : gate;
}

/**
 * Better Auth clears `error` and sets `isPending` while a null-session refetch
 * runs, which would otherwise look like a cold "loading" and unmount the
 * reconnect UI (resetting backoff). Hold the unreachable screen across that
 * refetch until the gate resolves to authenticated or anonymous.
 */
export function holdUnreachableGate(gate: SessionGate, holding: boolean): boolean {
  if (gate === "unreachable") return true;
  if (gate === "authenticated" || gate === "anonymous") return false;
  return holding;
}

/**
 * The same refetch runs whenever a signed-out tab regains focus. Showing the
 * cold "loading" screen then would unmount the auth page and drop its form
 * state, such as an emailed code waiting to be entered. Keep the signed-out
 * routes rendered across that refetch until the gate resolves again.
 */
export function holdAnonymousGate(gate: SessionGate, holding: boolean): boolean {
  if (gate === "anonymous") return true;
  if (gate === "authenticated" || gate === "unreachable") return false;
  return holding;
}

export function showSessionUnavailable(gate: SessionGate, holding: boolean): boolean {
  return gate === "unreachable" || (holding && gate === "loading");
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;

/** Jittered exponential backoff for retrying an unreachable session lookup. */
export function sessionRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempt);
  return jitterMs(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent), random);
}
