import type { Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { McpServer } from "@rakazo/contracts";
import { MCP_OAUTH_CHANNEL } from "../src/lib/mcp-oauth-channel";
import { captureScreenshot, completeOnboarding, openIntegrationsAdd, signup } from "./helpers";

test("connects an MCP server through the OAuth popup callback", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mcp-oauth-${stamp}@rakazo.test`, "password12", "MCP OAuth");
  await completeOnboarding(page);

  let oauthStatus: McpServer["oauthStatus"] = "none";
  let hasSecret = false;
  const server: McpServer = {
    id: "mcp-oauth-server",
    spaceId: "mcp-oauth-workspace",
    slug: "linear",
    name: "Linear MCP",
    description: "",
    transport: "streamable_http",
    endpoint: "https://mcp.linear.test/mcp",
    command: null,
    args: [],
    envKeys: [],
    fileKeys: [],
    headerKeys: [],
    hasSecret,
    oauthStatus,
    oauthClientId: null,
    enabled: true,
    revision: 1,
    health: { status: "unknown", message: null, toolCount: null, checkedAt: null },
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
  const browserOrigin = new URL(page.url()).origin;
  let releaseCompletion = () => {};
  let markCompletionStarted = () => {};
  const completionGate = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  const completionStarted = new Promise<void>((resolve) => {
    markCompletionStarted = resolve;
  });

  await page.context().route("**/rpc/mcp/servers/list", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: [{ ...server, hasSecret, oauthStatus }] }),
    });
  });
  await page.context().route("**/rpc/mcp/assignments/all", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: [] }) });
  });
  await page.context().route("**/rpc/mcp/oauth/begin", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      json: {
        serverId: server.id,
        redirectUri: `${browserOrigin}/mcp/oauth/callback`,
      },
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          status: "authorization_required",
          sessionId: "mcp-oauth-session",
          authorizationUrl: `${browserOrigin}/mcp/oauth/callback?code=fake-code&state=mcp-oauth-session`,
          completion: "popup",
        },
      }),
    });
  });
  await page.context().route("**/rpc/mcp/oauth/complete", async (route: Route) => {
    expect(route.request().postDataJSON()).toEqual({
      json: {
        sessionId: "mcp-oauth-session",
        code: "fake-code",
        state: "mcp-oauth-session",
      },
    });
    markCompletionStarted();
    await completionGate;
    oauthStatus = "connected";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: { ok: true } }),
    });
  });

  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  await openIntegrationsAdd(page, "Manage MCP servers");
  await expect(page.getByText("Linear MCP", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Access token (optional)")).toBeHidden();
  await captureScreenshot(page, testInfo, "mcp-oauth-ready");

  await page.getByText("Advanced", { exact: true }).click();
  await expect(page.getByLabel("Access token (optional)")).toBeVisible();
  await page.getByText("Advanced", { exact: true }).click();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect OAuth", exact: true }).click();
  const popup = await popupPromise;
  await completionStarted;
  await expect(popup.getByText("Finishing MCP connection…", { exact: true })).toBeVisible();
  await captureScreenshot(popup, testInfo, "mcp-oauth-callback");

  releaseCompletion();
  await expect(page.getByText("OAuth connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect OAuth", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await captureScreenshot(page, testInfo, "mcp-oauth-connected");

  oauthStatus = "reconnect";
  hasSecret = true;
  await page.evaluate((channelName) => {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({ type: "mcp-oauth-complete" });
    channel.close();
  }, MCP_OAUTH_CHANNEL);
  await expect(page.getByText("OAuth expired", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "mcp-oauth-expired");
});

test("finishes a loopback-only provider by pasting the address it lands on", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mcp-oauth-paste-${stamp}@rakazo.test`, "password12", "MCP Paste");
  await completeOnboarding(page);

  let oauthStatus: McpServer["oauthStatus"] = "none";
  const server: McpServer = {
    id: "mcp-paste-server",
    spaceId: "mcp-paste-workspace",
    slug: "upwork",
    name: "Upwork",
    description: "",
    transport: "streamable_http",
    endpoint: "https://mcp.upwork.test/mcp",
    command: null,
    args: [],
    envKeys: [],
    fileKeys: [],
    headerKeys: [],
    hasSecret: false,
    oauthStatus,
    enabled: true,
    revision: 1,
    health: { status: "unknown", message: null, toolCount: null, checkedAt: null },
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  };
  const loopback = "http://127.0.0.1:53682/mcp/oauth/callback";
  let completed: unknown;

  await page.context().route("**/rpc/mcp/servers/list", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: [{ ...server, oauthStatus }] }),
    });
  });
  await page.context().route("**/rpc/mcp/assignments/all", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: [] }) });
  });
  await page.context().route("**/rpc/mcp/oauth/begin", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          status: "authorization_required",
          sessionId: "paste-session",
          authorizationUrl: `https://auth.upwork.test/authorize?redirect_uri=${encodeURIComponent(loopback)}&state=paste-session`,
          completion: "paste",
        },
      }),
    });
  });
  await page.context().route("https://auth.upwork.test/**", async (route) => {
    await route.fulfill({ contentType: "text/html", body: "<p>Approve Manor</p>" });
  });
  await page.context().route("**/rpc/mcp/oauth/complete", async (route: Route) => {
    completed = route.request().postDataJSON();
    oauthStatus = "connected";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: { ok: true } }),
    });
  });

  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  const access = page.getByTestId("integrations-advanced");
  await expandAdvancedSection(access);
  // Manor's API & agent access section always offers it, beside upstream's add menu.
  await access.getByRole("button", { name: "Manage MCP servers", exact: true }).click();
  await expect(
    page.getByText("Servers that ask you to sign in show Connect OAuth once added."),
  ).toBeVisible();

  const signIn = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect OAuth", exact: true }).click();
  await (await signIn).close();
  const panel = page.getByTestId("mcp-oauth-paste");
  await expect(panel).toBeVisible();
  await panel
    .getByLabel("Address after approving")
    .fill(`${loopback}?code=pasted-code&state=paste-session`);
  await captureScreenshot(page, testInfo, "mcp-oauth-paste-back");
  await panel.getByRole("button", { name: "Finish connecting" }).click();

  await expect(page.getByText("OAuth connected", { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(completed).toEqual({
    json: { sessionId: "paste-session", code: "pasted-code", state: "paste-session" },
  });
});

test("adds an MCP server with a pre-registered OAuth client", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mcp-oauth-client-${stamp}@rakazo.test`, "password12", "MCP OAuth");
  await completeOnboarding(page);

  const browserOrigin = new URL(page.url()).origin;
  const servers: McpServer[] = [];
  await page.context().route("**/rpc/mcp/servers/list", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: servers }),
    });
  });
  await page.context().route("**/rpc/mcp/servers/create", async (route) => {
    const { json } = route.request().postDataJSON() as { json: Record<string, unknown> };
    expect(json).toMatchObject({
      transport: "streamable_http",
      endpoint: "https://gmailmcp.example.test/mcp/v1",
      oauthClient: { clientId: "client-1.apps.example.test", clientSecret: "client-secret" },
    });
    const created: McpServer = {
      id: "mcp-oauth-client-server",
      spaceId: "mcp-oauth-workspace",
      slug: "gmail",
      name: "Gmail",
      description: "",
      transport: "streamable_http",
      endpoint: "https://gmailmcp.example.test/mcp/v1",
      command: null,
      args: [],
      envKeys: [],
      fileKeys: [],
      headerKeys: [],
      hasSecret: true,
      oauthStatus: "none",
      oauthClientId: "client-1.apps.example.test",
      enabled: true,
      revision: 1,
      health: { status: "unknown", message: null, toolCount: null, checkedAt: null },
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    };
    servers.push(created);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: created }),
    });
  });

  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  await openIntegrationsAdd(page, "Manage MCP servers");

  await page.getByLabel("Server name").fill("Gmail");
  await page.getByLabel("Server URL").fill("https://gmailmcp.example.test/mcp/v1");
  await page.getByText("Advanced", { exact: true }).click();
  await expect(page.getByLabel("Redirect URI")).toBeHidden();
  await page.getByLabel("OAuth client ID (optional)").fill("client-1.apps.example.test");
  await page.getByLabel("OAuth client secret (optional)").fill("client-secret");
  await expect(page.getByLabel("Redirect URI")).toHaveValue(`${browserOrigin}/mcp/oauth/callback`);
  await captureScreenshot(page, testInfo, "mcp-oauth-client-form");

  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await expect(page.getByText("Gmail", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect OAuth", exact: true })).toBeVisible();
  await expect(page.getByLabel("OAuth client ID (optional)")).toHaveValue("");
  await expect(page.getByLabel("OAuth client secret (optional)")).toHaveValue("");
});
