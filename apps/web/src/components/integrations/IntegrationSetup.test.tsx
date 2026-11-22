// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntegrationSetup } from "./IntegrationSetup";

const api = vi.hoisted(() => ({
  capabilities: { catalogSearch: vi.fn() },
  mcp: { oauth: { complete: vi.fn() } },
}));

vi.mock("../../lib/query/rpc", () => ({ rpc: api }));
const connectMcpEndpoint = vi.hoisted(() => vi.fn());

vi.mock("../../lib/integrations/mcp-connect", () => ({ connectMcpEndpoint }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + (i ? String(values[i - 1]) : "") + part, ""),
  }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.capabilities.catalogSearch.mockReset().mockResolvedValue({ enabled: true, results: [] });
  connectMcpEndpoint.mockReset();
  api.mcp.oauth.complete.mockReset().mockResolvedValue({ ok: true });
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("does not search on open without a query", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <IntegrationSetup />
      </StrictMode>,
    ),
  );
  expect(host.querySelector("input")?.value).toBe("");
  expect(host.textContent).not.toContain("No remote MCP servers found");
  expect(api.capabilities.catalogSearch).not.toHaveBeenCalled();
});

it("searches the public catalog once for a query it opens with", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <IntegrationSetup initialQuery="canva" />
      </StrictMode>,
    ),
  );
  await vi.waitFor(() => expect(host.textContent).toContain("No remote MCP servers found"));
  expect(host.querySelector("input")?.value).toBe("canva");
  expect(api.capabilities.catalogSearch.mock.calls).toEqual([
    [{ query: "canva", usePublicCatalog: true }],
  ]);
});

async function connectTracker() {
  api.capabilities.catalogSearch.mockResolvedValue({
    enabled: true,
    results: [
      {
        domain: "tracker.example",
        name: "Tracker",
        description: "",
        pageUrl: null,
        surfaces: [
          {
            slug: "tracker-mcp",
            kind: "mcp",
            source: "https://mcp.tracker.example/mcp",
            auth: { type: "oauth", headerName: null, note: null },
          },
        ],
      },
    ],
  });
  await act(async () => root.render(<IntegrationSetup botId="bot-1" initialQuery="tracker" />));
  await vi.waitFor(() => expect(host.textContent).toContain("Tracker"));
  const connect = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Connect" && !button.closest("details"),
  );
  await act(async () => connect?.click());
}

it("signs in to a catalog server for the bot", async () => {
  connectMcpEndpoint.mockResolvedValue("connected");
  await connectTracker();
  expect(connectMcpEndpoint).toHaveBeenCalledWith({
    name: "Tracker",
    endpoint: "https://mcp.tracker.example/mcp",
    botId: "bot-1",
  });
  expect(host.textContent).toContain("Connected");
});

it("connects a catalog server that needs no sign-in", async () => {
  connectMcpEndpoint.mockResolvedValue("authorization_not_requested");
  await connectTracker();
  expect(host.textContent).toContain("Connected");
});

it("leaves a catalog server unconnected when sign-in is cancelled", async () => {
  connectMcpEndpoint.mockResolvedValue("cancelled");
  await connectTracker();
  expect(host.textContent).not.toContain("Connected");
});

// Manor: a loopback-only provider finishes by pasting the address back, so it is not connected yet.
it("asks for the pasted address before counting a paste-back sign-in as connected", async () => {
  connectMcpEndpoint.mockResolvedValue({
    paste: { sessionId: "session-1", authorizationUrl: "https://auth.tracker.example/authorize" },
  });
  await connectTracker();
  expect(host.textContent).not.toContain("Connected");
  // The paste form loads when it is first needed.
  await vi.waitFor(() =>
    expect(host.querySelector('input[aria-label="Address after approving"]')).not.toBeNull(),
  );
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Address after approving"]');
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, "http://127.0.0.1:53682/mcp/oauth/callback?code=abc&state=session-1");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const finish = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Finish connecting",
  );
  await act(async () => finish?.click());
  expect(api.mcp.oauth.complete).toHaveBeenCalledWith({
    sessionId: "session-1",
    code: "abc",
    state: "session-1",
  });
  expect(host.textContent).toContain("Connected");
  expect(host.querySelector('[data-testid="mcp-oauth-paste"]')).toBeNull();
});

it("does not offer a catalog server that needs a key", async () => {
  api.capabilities.catalogSearch.mockResolvedValue({
    enabled: true,
    results: [
      {
        domain: "keyed.example",
        name: "Keyed",
        description: "",
        pageUrl: null,
        surfaces: [
          {
            slug: "keyed-mcp",
            kind: "mcp",
            source: "https://mcp.keyed.example/mcp",
            auth: { type: "bearer", headerName: null, note: null },
          },
        ],
      },
    ],
  });
  await act(async () => root.render(<IntegrationSetup initialQuery="keyed" />));
  await vi.waitFor(() => expect(host.textContent).toContain("No remote MCP servers found"));
});
