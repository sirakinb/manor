import { brands, defaultBrand } from "@rakazo/brands";
import { describe, expect, it } from "vitest";
import { signInCapabilities } from "./sign-in-capabilities.js";

const social = {
  providers: [
    {
      id: "google" as const,
      name: "Google" as const,
      clientId: "fake-google-client",
      clientSecret: "fake-google-secret",
    },
  ],
};
const primary = new Headers({ host: "localhost:3000" });
const portalHost = brands.find((brand) => brand.id !== defaultBrand.id)?.hostnames[0];
const portal = new Headers({ host: portalHost ?? "" });
const demoAccount = { email: "demo@example.test", password: "fake-demo-password" };
const ids = (env: Parameters<typeof signInCapabilities>[0], headers: Headers) =>
  signInCapabilities(env, headers).providers?.map((provider) => provider.id);

describe("sign-in capabilities", () => {
  it("does not list Google while social sign-in is off, even when it is configured", () => {
    expect(ids({ social }, primary)).toEqual([]);
  });

  it("lists Google on the primary host when social sign-in is on", () => {
    expect(ids({ social, socialSignInEnabled: true }, primary)).toEqual(["google"]);
  });

  it.skipIf(!portalHost)("never lists Google on a brand portal", () => {
    expect(ids({ social, socialSignInEnabled: true }, portal)).toEqual([]);
  });

  it("lists organization SSO on any host", () => {
    const oidc = { name: "Company SSO" };
    expect(ids({ oidc }, primary)).toEqual(["oidc"]);
    if (portalHost) expect(ids({ oidc }, portal)).toEqual(["oidc"]);
  });

  it.skipIf(!portalHost)("offers the demo sign-in only on the primary host", () => {
    expect(signInCapabilities({ demoAccount }, primary).demoAccount).toEqual(demoAccount);
    expect(signInCapabilities({ demoAccount }, portal).demoAccount).toBeNull();
  });
});
