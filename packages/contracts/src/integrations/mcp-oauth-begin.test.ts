import { expect, it } from "vitest";
import { appContract } from "../rpc/app-contract.js";

// Manor: a provider that only accepts a loopback callback signs in by pasting it back ("paste").
const started = {
  status: "authorization_required",
  sessionId: "session-1",
  authorizationUrl: "https://auth.example.test/authorize",
};

it("says how an MCP sign-in finishes, whether it starts alone or while adding a server", () => {
  const begin = appContract.mcp.oauth.begin["~orpc"].outputSchema!;
  const connect = appContract.mcp.servers.connect["~orpc"].outputSchema!;
  expect(begin.parse({ ...started, completion: "paste" })).toMatchObject({ completion: "paste" });
  expect(begin.safeParse(started).success).toBe(false);
  expect(begin.parse({ status: "already_connected" })).toEqual({ status: "already_connected" });
  const server = connect.safeParse({ server: {}, signIn: { ...started, completion: "popup" } });
  expect(server.success ? null : server.error.issues.map((issue) => issue.path[0])).not.toContain(
    "signIn",
  );
  const missing = connect.safeParse({ server: {}, signIn: started });
  expect(missing.success ? [] : missing.error.issues.map((issue) => issue.path[0])).toContain(
    "signIn",
  );
});
