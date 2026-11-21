import { describe, expect, it, vi } from "vitest";
import {
  assertSignupAllowed,
  authRateLimitOptions,
  buildTrustedOrigins,
  createAuth,
  isBlockedAuthPath,
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
  it("records successful session creation without overwriting a newer sign-in", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auth = createAuth({ user: { updateMany } } as never, {
      secret: "test-secret-at-least-32-characters-long",
      baseURL: "http://localhost",
      webOrigin: "http://localhost",
      ...env,
    });
    const createdAt = new Date("2026-09-10T12:00:00Z");
    await auth.options.databaseHooks?.session?.create?.after?.(
      {
        userId: "user-a",
        createdAt,
      } as never,
      null,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "user-a",
        OR: [{ lastSignedInAt: null }, { lastSignedInAt: { lt: createdAt } }],
      },
      data: { lastSignedInAt: createdAt },
    });
  });

  it("closes every organization plugin route", () => {
    for (const path of [
      "/organization/delete",
      "/organization/update",
      "/organization/leave",
      "/organization/create",
      "/organization/invite-member",
      "/organization/cancel-invitation",
      "/organization/set-active",
      "/organization/list",
      "/organization/create-team",
      "/organization/some-future-route",
    ]) {
      expect(isBlockedAuthPath(path), path).toBe(true);
    }
  });

  it("keeps the account routes the apps call", () => {
    for (const path of [
      "/sign-up/email",
      "/sign-in/email",
      "/sign-out",
      "/get-session",
      "/change-password",
      "/request-password-reset",
      "/reset-password",
      "/delete-user",
    ]) {
      expect(isBlockedAuthPath(path), path).toBe(false);
    }
  });

  it.each(["sign-in/email", "sign-up/email"])("logs internal failures from %s", async (path) => {
    const error = new Error("database unavailable");
    const log = vi.fn();
    const auth = createAuth(
      { deploymentSettings: { findUnique: vi.fn().mockRejectedValue(error) } } as never,
      {
        secret: "offline-auth-secret-at-least-32-characters",
        baseURL: "https://api.example.test",
        webOrigin: "https://app.example.test",
        signupsEnabled: "true",
        signupAllowlist: "",
        logger: { level: "error", log },
      },
    );
    const response = await auth.handler(
      new Request(`https://api.example.test/api/auth/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example.test" },
        body: JSON.stringify({
          email: "test@example.test",
          password: "test-password-123",
          name: "Test",
        }),
      }),
    );
    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledWith("error", expect.any(String), error);
  });

  it("disables organization deletion inside Better Auth as well", async () => {
    const auth = createAuth({} as never, {
      secret: "test-secret-that-is-long-enough-for-better-auth",
      baseURL: "http://127.0.0.1:3100",
      webOrigin: "http://127.0.0.1:5173",
      signupsEnabled: undefined,
      signupAllowlist: undefined,
    });

    const res = await auth.handler(
      new Request("http://127.0.0.1:3100/api/auth/organization/delete", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({ organizationId: "space-1" }),
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "ORGANIZATION_DELETION_DISABLED" });
  });
});

describe("authRateLimitOptions", () => {
  it("caps credential routes at 10 attempts per 15 minutes in a shared table", () => {
    expect(authRateLimitOptions("production")).toEqual({
      enabled: true,
      storage: "database",
      customRules: {
        "/request-account-deletion": { window: 600, max: 3 },
        "/sign-in/email": { window: 15 * 60, max: 10 },
        "/sign-up/email": { window: 15 * 60, max: 10 },
        "/request-password-reset": { window: 15 * 60, max: 10 },
      },
    });
  });

  it("stays off outside production so the test suite can sign in", () => {
    expect(authRateLimitOptions("test").enabled).toBe(false);
  });
});

describe("buildTrustedOrigins", () => {
  it("adds the localhost twin for a 127.0.0.1 web origin", () => {
    expect(
      buildTrustedOrigins({
        webOrigin: "http://127.0.0.1:5173",
        baseURL: "http://127.0.0.1:5173",
      }),
    ).toEqual(expect.arrayContaining(["http://127.0.0.1:5173", "http://localhost:5173"]));
  });

  it("keeps extraOrigins and does not twin non-loopback hosts", () => {
    expect(
      buildTrustedOrigins({
        webOrigin: "https://app.example.test",
        baseURL: "https://api.example.test",
        extraOrigins: ["https://extra.example.test"],
      }),
    ).toEqual([
      "https://app.example.test",
      "https://api.example.test",
      "https://extra.example.test",
    ]);
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
