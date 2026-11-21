import { createHmac } from "node:crypto";
import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import {
  accountDeletionRefusal,
  assertSignupAllowed,
  authRateLimitOptions,
  buildTrustedOrigins,
  createAuth,
  isBlockedAuthPath,
  passwordResetEmail,
  signInCodeEmail,
  signupBrandId,
} from "./index.js";

const env = { signupsEnabled: "true", signupAllowlist: "" };

describe("assertSignupAllowed", () => {
  it("rejects every new account while registration is closed", () => {
    expect(() =>
      assertSignupAllowed({ signupsEnabled: "false", signupAllowlist: "" }, "someone@example.com"),
    ).toThrow("Registration is closed");
  });

  it("rejects an address outside the allowlist", () => {
    expect(() =>
      assertSignupAllowed(
        { signupsEnabled: "true", signupAllowlist: "@company.test" },
        "outsider@example.com",
      ),
    ).toThrow("Email is not allowed to register");
  });

  it("admits an allowlisted address", () => {
    expect(() =>
      assertSignupAllowed(
        { signupsEnabled: "true", signupAllowlist: "@company.test" },
        "person@company.test",
      ),
    ).not.toThrow();
  });

  // Google never hits a "sign-up" route, so the policy has to hang off user
  // creation. Asserting the wiring keeps it from drifting back onto a path check.
  it("is enforced on user creation, which social sign-in also goes through", async () => {
    const auth = createAuth({} as never, {
      secret: "test-secret-at-least-32-characters-long",
      baseURL: "http://localhost",
      webOrigin: "http://localhost",
      signupsEnabled: "false",
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
      {
        user: {
          findFirst: vi.fn().mockRejectedValue(error),
          findMany: vi.fn().mockRejectedValue(error),
          count: vi.fn().mockRejectedValue(error),
          create: vi.fn().mockRejectedValue(error),
        },
      } as never,
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

describe("accountDeletionRefusal", () => {
  it("turns a refused deletion into a bad request that keeps its reason", () => {
    const refused = Object.assign(new Error("Ask the organization's owner first."), {
      code: "ACCOUNT_DELETION_REFUSED",
    });
    const mapped = accountDeletionRefusal(refused);
    expect(mapped).toBeInstanceOf(APIError);
    expect(mapped).toMatchObject({
      status: "BAD_REQUEST",
      body: { message: "Ask the organization's owner first.", code: "ACCOUNT_DELETION_REFUSED" },
    });
  });

  it("passes any other error through unchanged", () => {
    const other = new Error("database down");
    expect(accountDeletionRefusal(other)).toBe(other);
  });
});

describe("authRateLimitOptions", () => {
  it("caps credential routes at 10 attempts per 15 minutes in a shared table", () => {
    expect(authRateLimitOptions("production")).toEqual({
      enabled: true,
      storage: "database",
      customRules: {
        "/request-account-deletion": { window: 600, max: 3 },
        "/request-identity-code": { window: 600, max: 3 },
        "/confirm-identity": { window: 15 * 60, max: 10 },
        "/sign-in/email": { window: 15 * 60, max: 10 },
        "/sign-up/email": { window: 15 * 60, max: 10 },
        "/request-password-reset": { window: 15 * 60, max: 10 },
        "/email-otp/send-verification-otp": { window: 15 * 60, max: 10 },
        "/sign-in/email-otp": { window: 15 * 60, max: 10 },
        "/passkey/verify-authentication": { window: 15 * 60, max: 10 },
        "/passkey/verify-registration": { window: 15 * 60, max: 10 },
        "/passkey/generate-authenticate-options": { window: 60, max: 30 },
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
  it("keeps the reset URL in text and escapes user-controlled HTML", async () => {
    const message = await passwordResetEmail(
      { id: "user-1", email: "ada@example.test", name: '<Ada & "team">' },
      "https://rakazo.test/reset-password?token=secret&next=1",
    );

    expect(message).toMatchObject({
      to: "ada@example.test",
      subject: "Reset your Manor password",
    });
    expect(message.text).toContain("https://rakazo.test/reset-password?token=secret&next=1");
    expect(message.html).toContain("&lt;Ada &amp; &quot;team&quot;&gt;");
    expect(message.html).toContain("token=secret&amp;next=1");
    expect(message.html).not.toContain('<Ada & "team">');
  });
});

describe("signInCodeEmail", () => {
  it("puts the code in plain text and HTML without links", async () => {
    const message = await signInCodeEmail("ada@example.test", "042517");
    expect(message).toMatchObject({ to: "ada@example.test", subject: "Your Manor sign-in code" });
    expect(message.text).toContain("042517");
    expect(message.html).toContain("042517");
    expect(message.text).not.toMatch(/https?:/);
    expect(message.html).not.toContain("<a ");
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

// Manor's user-create hook checks the signup policy, which comes from the environment.
const noDatabase = {} as never;

describe("stored account names", () => {
  const auth = createAuth(noDatabase, {
    secret: "offline-auth-secret-at-least-32-characters",
    baseURL: "https://api.example.test",
    webOrigin: "https://app.example.test",
    signupsEnabled: "true",
    signupAllowlist: "",
  });
  it.each(["", " ", "__TestTok1__", "550e8400-e29b-41d4-a716-446655440000"])(
    "normalizes unusable names on creation and updates: %s",
    async (name) => {
      const hooks = auth.options.databaseHooks!.user!;
      expect(
        await hooks.create!.before!({ name, email: "demo@example.com" } as never, null),
      ).toMatchObject({ data: { name: "" } });
      expect(await hooks.update!.before!({ name })).toMatchObject({ data: { name: "" } });
    },
  );
  it("preserves real names and does not change names during unrelated updates", async () => {
    const hook = auth.options.databaseHooks!.user!.update!.before!;
    expect(await hook({ name: " 李雷 " })).toMatchObject({ data: { name: "李雷" } });
    const result = await hook({ emailVerified: true });
    expect(result).toEqual({ data: { emailVerified: true } });
  });
});

it("preserves readable numbered account names on writes", async () => {
  const auth = createAuth(noDatabase, {
    secret: "offline-auth-secret-at-least-32-characters",
    baseURL: "https://api.example.test",
    webOrigin: "https://app.example.test",
    signupsEnabled: "true",
    signupAllowlist: "",
  });
  expect(
    await auth.options.databaseHooks!.user!.create!.before!(
      {
        name: "CustomerSupportBot2026",
        email: "demo@example.com",
      } as never,
      null,
    ),
  ).toMatchObject({ data: { name: "CustomerSupportBot2026" } });
});

describe("bearer sessions", () => {
  const secret = "offline-auth-secret-at-least-32-characters";
  const token = "fakeSessionToken0123456789abcdef";

  function authWithSessionLookups() {
    const lookups: unknown[] = [];
    const model = new Proxy(
      {},
      {
        get: () =>
          vi.fn(async (query: unknown) => {
            lookups.push(query);
            return null;
          }),
      },
    );
    const prisma = new Proxy({}, { get: (_target, name) => (name === "then" ? undefined : model) });
    const auth = createAuth(prisma as never, {
      secret,
      baseURL: "https://api.example.test",
      webOrigin: "https://app.example.test",
      signupsEnabled: "true",
      signupAllowlist: "",
    });
    return { auth, lookups };
  }

  function signed(value: string, key = secret) {
    return `${value}.${createHmac("sha256", key).update(value).digest("base64")}`;
  }

  it.each([
    ["a raw session token", token],
    ["a token signed with another key", signed(token, "another-secret-of-at-least-32-chars")],
  ])("never looks up a session for %s", async (_label, bearer) => {
    const { auth, lookups } = authWithSessionLookups();
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${bearer}` }),
    });
    expect(session).toBeNull();
    expect(JSON.stringify(lookups)).not.toContain(token);
  });

  it.each([
    ["raw", signed(token)],
    ["URL-encoded", encodeURIComponent(signed(token))],
  ])("looks up the session for a %s signed token", async (_label, bearer) => {
    const { auth, lookups } = authWithSessionLookups();
    await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${bearer}` }) });
    expect(JSON.stringify(lookups)).toContain(token);
  });
});
