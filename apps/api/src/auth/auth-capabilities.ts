import type { TransactionalEmailProvider } from "@rakazo/adapter-kit";
import type { Auth } from "@rakazo/auth";
import type { AuthCapabilities } from "@rakazo/contracts";
import type { Hono } from "hono";
import type { BillingService } from "../billing/billing.js";
import type { AppEnv } from "../env.js";
import { nativePasskeys, passkeyRpIdForRequest } from "../http/app-association.js";
import { signInCapabilities } from "../sign-in-capabilities.js";

/** `GET /api/auth/capabilities`: the sign-in options this deployment offers. */
export function mountAuthCapabilities(
  app: Hono,
  {
    env,
    auth,
    email,
    billing,
  }: {
    env: AppEnv;
    auth: Auth;
    email: TransactionalEmailProvider | undefined;
    billing: BillingService | undefined;
  },
) {
  app.get("/api/auth/capabilities", (c) => {
    const registrationOpen = env.desktopStackToken
      ? auth.registrationOpen(c.req.raw.headers)
      : undefined;
    // Manor: brand portals live on other domains, where the relying party cannot sign in.
    const passkeyRpId = passkeyRpIdForRequest(auth.passkeyRpId, c.req.raw.headers);
    return c.json({
      sso: env.oidc
        ? { name: env.oidc.name, availability: auth.ssoAvailability() ?? "checking" }
        : null,
      // Manor: social buttons need SOCIAL_SIGN_IN_ENABLED and the primary host; no demo on a portal.
      ...signInCapabilities(env, c.req.raw.headers),
      passwordAuth: env.passwordAuth !== false,
      passwordReset: env.passwordAuth !== false && Boolean(email),
      resetUrl:
        env.passwordAuth !== false && email ? new URL("/reset-password", env.webOrigin).href : null,
      emailCode: auth.emailCodeSignIn,
      registrationOpen,
      billing: Boolean(billing),
      passkeyRpId,
      nativePasskeys: nativePasskeys(env, passkeyRpId),
      crispWebsiteId: billing ? (env.crispWebsiteId ?? null) : null,
    } satisfies AuthCapabilities);
  });
}
