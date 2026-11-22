import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeSandboxProvider } from "@rakazo/adapters";
import { asSystem, runAsSystem } from "@rakazo/db";
import { expect, it } from "vitest";
import { sessionCookieHeader } from "../../../../packages/testkit/src/index.js";
import { createApp } from "../app.js";

const databaseUrl = process.env.VERIFY_DATABASE === "1" ? process.env.DATABASE_URL : undefined;

it.skipIf(!databaseUrl).each([
  { sandboxProvider: "docker", nativeToken: true, expected: true },
  { sandboxProvider: "docker", nativeToken: false, expected: false },
  { sandboxProvider: "fake", nativeToken: true, expected: false },
])("exposes native host choice only on a managed Docker instance (%j)", async (fixture) => {
  const dataDir = await mkdtemp(join(tmpdir(), "rakazo-host-choice-"));
  const emailFor = (role: string) =>
    `host-choice-${role}-${fixture.sandboxProvider}-${fixture.nativeToken}@example.test`;
  const handles = await createApp({
    databaseUrl: databaseUrl!,
    dataDir,
    sandboxProvider: fixture.sandboxProvider,
    sandbox: new FakeSandboxProvider(),
    desktopStackToken: fixture.nativeToken ? "ab".repeat(32) : undefined,
    agentRuntime: "scripted",
    wakeupDriver: "memory",
    signupsEnabled: "true",
    signupAllowlist: "",
    webOrigin: "http://127.0.0.1:5173",
    authUrl: "http://127.0.0.1:5173",
  });
  const system = asSystem(handles.prisma);
  let previousOwner: string | null | undefined;
  try {
    const signUp = async (role: string) => {
      const signup = await handles.app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({
          email: emailFor(role),
          password: "test-password-123",
          name: "Host tester",
        }),
      });
      expect(signup.status).toBeLessThan(400);
      const { user } = (await signup.clone().json()) as { user: { id: string } };
      return { userId: user.id, cookie: sessionCookieHeader(signup) };
    };
    const owner = await signUp("owner");
    // A managed stack (desktop token set) admits only its first account, so it has no member.
    const member = fixture.nativeToken ? undefined : await signUp("member");
    // Manor keeps a deployment owner (the first sign-up); host choice must not depend on it.
    previousOwner =
      (await system.deploymentSettings.findUnique({ where: { id: "default" } }))?.ownerUserId ??
      null;
    await system.deploymentSettings.update({
      where: { id: "default" },
      data: { ownerUserId: owner.userId },
    });
    const accounts = [[owner, true] as const, ...(member ? [[member, false] as const] : [])];
    for (const [account, isDeploymentOwner] of accounts) {
      for (const procedure of ["me", "bootstrap"]) {
        const response = await handles.app.request(`/rpc/${procedure}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: account.cookie,
            origin: "http://127.0.0.1:5173",
          },
          body: JSON.stringify({ json: {} }),
        });
        expect(response.status).toBe(200);
        const { json } = await response.json();
        expect(procedure === "me" ? json : json.me).toMatchObject({
          canChooseHostComputer: fixture.expected,
          isDeploymentOwner,
        });
      }
    }
  } finally {
    if (previousOwner !== undefined) {
      await system.deploymentSettings.update({
        where: { id: "default" },
        data: { ownerUserId: previousOwner },
      });
    }
    // A managed stack admits only its first account, so each case starts without one.
    await runAsSystem("remove the host choice testers", () =>
      handles.prisma.user.deleteMany({
        where: { email: { in: [emailFor("owner"), emailFor("member")] } },
      }),
    );
    await handles.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});
