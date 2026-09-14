import posthog from "posthog-js";

/**
 * Thin PostHog wrapper for the Manor product app (apps/web).
 *
 * The PostHog project token is provided at build time via VITE_POSTHOG_KEY
 * (Vite only exposes client-side env vars that are prefixed with VITE_,
 * matching the convention already used by apps/www's PUBLIC_POSTHOG_KEY).
 * If the key isn't set, everything here is a safe no-op, so local/dev/self-hosted
 * builds without a token never call out to PostHog.
 *
 * Events fired from this app are tagged `environment: "app"` to distinguish
 * them from any marketing/landing-page traffic that may later land in the
 * same "Manor" PostHog project tagged `environment: "marketing"`.
 */

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
  "https://us.i.posthog.com";

let initialized = false;

export function initAnalytics() {
  if (initialized || !POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    persistence: "localStorage+cookie",
  });
  initialized = true;
}

/** Call on login / whenever a session resolves to a known user. */
export function identifyUser(userId: string, props?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.identify(userId, props);
}

/** Call on logout. */
export function resetAnalytics() {
  if (!initialized) return;
  posthog.reset();
}

/** Fires a custom event, tagged environment: "app" (this signed-in product). */
export function trackEvent(name: string, props?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.capture(name, { environment: "app", ...props });
}
