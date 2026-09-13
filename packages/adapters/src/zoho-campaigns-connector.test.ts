import type { AdapterContext, ConnectorEvent } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { ZOHO_CAMPAIGNS_CONNECTOR_ID, ZohoCampaignsConnector } from "./zoho-campaigns-connector.js";

const workspaceId = "workspace-jrh";
const context: AdapterContext = {
  operationId: "zoho-campaigns-test",
  traceId: "zoho-campaigns-test",
  spaceId: "space-jrh",
  userId: "user-aki",
  signal: new AbortController().signal,
};

const credential = {
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
};

async function collect(events: AsyncIterable<ConnectorEvent>) {
  const output: ConnectorEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

function connector(options?: {
  fields?: typeof credential | null;
  workspaceId?: string | null;
  fetch?: typeof fetch;
}) {
  return new ZohoCampaignsConnector({
    prisma: {} as never,
    secrets: {} as never,
    resolveWorkspaceId: async () =>
      options?.workspaceId === undefined ? workspaceId : options.workspaceId,
    loadCredential: async () => (options?.fields === undefined ? credential : options.fields),
    fetch: options?.fetch,
  });
}

describe("ZohoCampaignsConnector", () => {
  it("lists Zoho Campaigns in the catalog when workspace credentials exist", async () => {
    const item = connector();
    await expect(item.catalog(context)).resolves.toEqual([
      expect.objectContaining({
        connectorId: ZOHO_CAMPAIGNS_CONNECTOR_ID,
        slug: "zoho-campaigns",
        name: "Zoho Campaigns",
        connected: true,
        noAuth: true,
      }),
    ]);
    await expect(item.catalog(context, "campaigns")).resolves.toHaveLength(1);
    await expect(item.catalog(context, "mailchimp")).resolves.toEqual([]);
    await expect(item.discoverTools(context)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "zoho_campaigns_list_lists", readOnly: true }),
        expect.objectContaining({ name: "zoho_campaigns_create_draft" }),
      ]),
    );
    await expect(
      item.begin({ provider: "zoho-campaigns", redirectUrl: "https://manor.example/app" }, context),
    ).resolves.toEqual({
      authorizationUrl: null,
      state: "zoho-campaigns",
    });
    await expect(item.listConnectedExternalIds(context)).resolves.toEqual(["zoho-campaigns"]);
  });

  it("hides tools when the workspace credential is missing", async () => {
    const item = connector({ fields: null });
    await expect(item.catalog(context)).resolves.toEqual([
      expect.objectContaining({ connected: false }),
    ]);
    await expect(item.discoverTools(context)).resolves.toEqual([]);
    await expect(item.connectionReady(context)).resolves.toBe(false);
    await expect(
      item.begin({ provider: "zoho-campaigns", redirectUrl: "https://manor.example/app" }, context),
    ).rejects.toThrow(/Workspace Settings/);
  });

  it("hides the connector when the actor has no workspace", async () => {
    const item = connector({ workspaceId: null });
    await expect(item.catalog(context)).resolves.toEqual([
      expect.objectContaining({ connected: false }),
    ]);
    await expect(item.discoverTools(context)).resolves.toEqual([]);
  });

  it("creates a draft and never calls send or schedule endpoints", async () => {
    const requests: Array<{ url: string; method?: string }> = [];
    const item = connector({
      fetch: vi.fn(async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, method: init.method });
        if (url.includes("/oauth/v2/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.includes("/createCampaign")) {
          return Response.json({ code: "0", campaignKey: "camp-1" });
        }
        return Response.json({ error: "unexpected" }, { status: 500 });
      }),
    });

    const events = await collect(
      item.execute(
        {
          tool: "zoho_campaigns_create_draft",
          args: {
            campaignName: "August 05",
            subject: "Find a Home That Fits",
            fromEmail: "lorenzo@jacksonrentalhomesllc.com",
            fromName: "Jackson Rental Homes",
            contentUrl: "https://res.cloudinary.com/demo/email.html",
            listKeys: ["list-1"],
          },
        },
        context,
      ),
    );

    expect(events).toEqual([
      {
        type: "result",
        data: {
          draft: true,
          sent: false,
          campaignName: "August 05",
          subject: "Find a Home That Fits",
          campaignKey: "camp-1",
        },
      },
    ]);
    expect(requests.some((row) => /send|schedule/i.test(row.url))).toBe(false);
    expect(requests.some((row) => row.url.includes("/createCampaign"))).toBe(true);
  });

  it("refuses a non-https content URL and redacts tokens in errors", async () => {
    const item = connector({
      fetch: vi.fn(async (input) => {
        if (String(input).includes("/oauth/v2/token")) {
          return Response.json({ access_token: "super-secret-access-token" });
        }
        return Response.json({ message: "leak super-secret-access-token" }, { status: 400 });
      }),
    });

    await expect(
      collect(
        item.execute(
          {
            tool: "zoho_campaigns_create_draft",
            args: {
              campaignName: "x",
              subject: "x",
              fromEmail: "a@b.c",
              fromName: "n",
              contentUrl: "http://insecure.example/email.html",
              listKeys: ["list-1"],
            },
          },
          context,
        ),
      ),
    ).resolves.toEqual([{ type: "error", message: "contentUrl must be a public https URL" }]);

    const leaked = await collect(
      item.execute({ tool: "zoho_campaigns_list_lists", args: {} }, context),
    );
    expect(leaked[0]).toMatchObject({ type: "error" });
    expect(JSON.stringify(leaked)).not.toContain("super-secret-access-token");
  });

  it("does not delete workspace credentials on revoke", async () => {
    const loadCredential = vi.fn(async () => credential);
    const item = new ZohoCampaignsConnector({
      prisma: {} as never,
      secrets: {} as never,
      resolveWorkspaceId: async () => workspaceId,
      loadCredential,
    });
    await item.revoke();
    expect(loadCredential).not.toHaveBeenCalled();
  });
});
