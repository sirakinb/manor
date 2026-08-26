import { describe, expect, it, vi } from "vitest";
import { createGoogleFormsTokenBroker, parseScopes } from "./google-forms-token-broker.js";

describe("parseScopes", () => {
  it("accepts comma- and space-delimited OAuth scope storage", () => {
    expect([...parseScopes("scope:a scope:b,scope:c")]).toEqual(["scope:a", "scope:b", "scope:c"]);
  });

  it("handles absent scope material", () => {
    expect([...parseScopes(null)]).toEqual([]);
  });

  it("requires every requested grant and resolves refreshed tokens through Better Auth", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      accessToken: "encrypted-token-material",
      scope: "scope:forms.body scope:forms.responses",
    });
    const getAccessToken = vi.fn().mockResolvedValue({ accessToken: "fresh-access-token" });
    const broker = createGoogleFormsTokenBroker(
      { account: { findFirst } } as never,
      { api: { getAccessToken } } as never,
    );

    await expect(
      broker.isConnected("user-1", ["scope:forms.body", "scope:forms.responses"]),
    ).resolves.toBe(true);
    await expect(
      broker.isConnected("user-1", ["scope:forms.body", "scope:drive.file"]),
    ).resolves.toBe(false);
    await expect(broker.accessToken("user-1")).resolves.toBe("fresh-access-token");
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", providerId: "google" },
      select: { accessToken: true, scope: true },
    });
    expect(getAccessToken).toHaveBeenCalledWith({
      body: { providerId: "google", userId: "user-1" },
    });
  });
});
