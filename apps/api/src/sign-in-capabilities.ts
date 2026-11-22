import type { OidcConfig, SocialAuthConfig } from "@rakazo/auth";
import { portalBrandId, publicSignInProviders } from "@rakazo/auth";
import type { AuthCapabilities } from "@rakazo/contracts";

/**
 * Manor: the sign-in choices a request's host offers. Google and Apple buttons are listed only
 * with `SOCIAL_SIGN_IN_ENABLED` and only on the primary host, since production configures Google
 * for the Forms link and a brand portal's callback would land on the primary host. The providers
 * stay registered in the auth library either way. Organization SSO is listed as upstream has it;
 * the demo sign-in is never offered on a brand portal.
 */
export function signInCapabilities(
  env: {
    social?: SocialAuthConfig;
    oidc?: Pick<OidcConfig, "name">;
    socialSignInEnabled?: boolean;
    demoAccount?: AuthCapabilities["demoAccount"];
  },
  headers: Headers,
): Pick<AuthCapabilities, "providers" | "demoAccount"> {
  const primaryHost = portalBrandId(headers) === null;
  const social = env.socialSignInEnabled && primaryHost ? env.social : undefined;
  return {
    providers: publicSignInProviders(social, env.oidc),
    demoAccount: primaryHost ? (env.demoAccount ?? null) : null,
  };
}
