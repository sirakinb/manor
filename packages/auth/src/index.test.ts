import { describe, expect, it, vi } from "vitest";
import {
  assertSignupAllowed,
  blockedAuthPaths,
  createAuth,
  passwordResetEmail,
  resolveSignupPolicy,
  signupBrandId,
} from "./index.js";

function settings(policy: { signupsEnabled: boolean; signupAllowlist: string }) {
  return {
    deploymentSettings: {
      findUnique: vi.fn().mockResolvedValue({ ...policy, signupPolicyInitialized: true }),
    },
  } as never;
}

const env = { signupsEnabled: "true", signupAllowlist: "" };

describe("assertSignupAllowed", () => {
  it("rejects every new account while registration is closed", async () => {
    const prisma = settings({ signupsEnabled: false, signupAllowlist: "" });
    await expect(assertSignupAllowed(prisma, env, "someone@example.com")).rejects.toThrow(
      "Registration is closed",
    );
  });

  it("rejects an address outside the allowlist", async () => {
    const prisma = settings({ signupsEnabled: true, signupAllowlist: "@company.test" });
    await expect(assertSignupAllowed(prisma, env, "outsider@example.com")).rejects.toThrow(
      "Email is not allowed to register",
    );
  });

  it("admits an allowlisted address", async () => {
    const prisma = settings({ signupsEnabled: true, signupAllowlist: "@company.test" });
    await expect(assertSignupAllowed(prisma, env, "person@company.test")).resolves.toBeUndefined();
  });

  // Google never hits a "sign-up" route, so the policy has to hang off user
  // creation. Asserting the wiring keeps it from drifting back onto a path check.
  it("is enforced on user creation, which social sign-in also goes through", async () => {
    const prisma = settings({ signupsEnabled: false, signupAllowlist: "" });
    const auth = createAuth(prisma, {
      secret: "test-secret-at-least-32-characters-long",
      baseURL: "http://localhost",
      webOrigin: "http://localhost",
      signupsEnabled: "true",
      signupAllowlist: "",
    });

    await expect(
      auth.options.databaseHooks?.user?.create?.before?.(
        {
          email: "google-user@example.com",
        } as never,
        null,
      ),
    ).rejects.toThrow("Registration is closed");
  });
});

describe("auth policy", () => {
  it("blocks invitation and org-creation paths in version 1", () => {
    expect(blockedAuthPaths.some((path) => path.includes("invite"))).toBe(true);
    expect(blockedAuthPaths.some((path) => path.includes("create"))).toBe(true);
  });
});

describe("passwordResetEmail", () => {
  it("keeps the reset URL in text and escapes user-controlled HTML", () => {
    const message = passwordResetEmail(
      { id: "user-1", email: "ada@example.test", name: '<Ada & "team">' },
      "https://rakazo.test/reset-password?token=secret&next=1",
    );

    expect(message).toMatchObject({
      to: "ada@example.test",
      subject: "Reset your Rakazo password",
    });
    expect(message.text).toContain("https://rakazo.test/reset-password?token=secret&next=1");
    expect(message.html).toContain("&lt;Ada &amp; &quot;team&quot;&gt;");
    expect(message.html).toContain("token=secret&amp;next=1");
    expect(message.html).not.toContain('<Ada & "team">');
  });
});

describe("resolveSignupPolicy", () => {
  it("uses environment defaults before deployment settings exist", async () => {
    const prisma = {
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      resolveSignupPolicy(prisma as never, {
        signupsEnabled: "false",
        signupAllowlist: "you@example.com,@company.test",
      }),
    ).resolves.toEqual({
      enabled: false,
      allowlist: ["you@example.com", "@company.test"],
    });
  });

  it("keeps using the environment policy for a pre-upgrade uninitialized row", async () => {
    const prisma = {
      deploymentSettings: {
        findUnique: vi.fn().mockResolvedValue({
          signupsEnabled: true,
          signupAllowlist: "",
          signupPolicyInitialized: false,
        }),
      },
    };
    await expect(
      resolveSignupPolicy(prisma as never, {
        signupsEnabled: "false",
        signupAllowlist: "existing-policy@example.com",
      }),
    ).resolves.toEqual({ enabled: false, allowlist: ["existing-policy@example.com"] });
  });

  it("uses live deployment settings as the effective policy after initial seeding", async () => {
    const prisma = {
      deploymentSettings: {
        findUnique: vi.fn().mockResolvedValue({
          signupsEnabled: false,
          signupAllowlist: "approved@example.com",
          signupPolicyInitialized: true,
        }),
      },
    };
    await expect(
      resolveSignupPolicy(prisma as never, {
        signupsEnabled: "false",
        signupAllowlist: "environment-only@example.com",
      }),
    ).resolves.toEqual({ enabled: false, allowlist: ["approved@example.com"] });
  });
});

describe("signupBrandId", () => {
  it("reads the branded host from the Origin header", () => {
    expect(signupBrandId({ origin: "https://jrhmanor.agentworkspace.cloud" })).toBe("jrh");
    expect(signupBrandId(new Headers({ origin: "https://JRHManor.agentworkspace.cloud" }))).toBe(
      "jrh",
    );
  });

  it("ignores untrusted forwarding headers and strips Host ports", () => {
    expect(
      signupBrandId({ "x-forwarded-host": "jrhmanor.agentworkspace.cloud, proxy" }),
    ).toBeNull();
    expect(signupBrandId({ host: "jrhmanor.agentworkspace.cloud:443" })).toBe("jrh");
  });

  it("is null for the default brand, unknown hosts, and missing headers", () => {
    expect(signupBrandId({ origin: "http://127.0.0.1:5173" })).toBeNull();
    expect(signupBrandId({ origin: "https://manor.example" })).toBeNull();
    expect(signupBrandId({ origin: "not a url" })).toBeNull();
    expect(signupBrandId({})).toBeNull();
    expect(signupBrandId(undefined)).toBeNull();
  });
});
