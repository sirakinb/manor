import type {
  AdapterContext,
  ConnectorCall,
  ConnectorCatalogItem,
  ConnectorEvent,
  ConnectorTool,
  ManagedConnectorProvider,
} from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { IsolationError, workspaceForAgent } from "@rakazo/db";
import {
  combineSignals,
  redactConnectorPayload,
  sanitizeConnectorError,
} from "./connector-safety.js";
import type { EncryptedSecretStore } from "./secrets.js";
import {
  loadWorkspaceCredential,
  type WorkspaceCredentialFields,
} from "./workspace-credentials.js";

export const ZOHO_CAMPAIGNS_CONNECTOR_ID = "zoho-campaigns";
export const ZOHO_CAMPAIGNS_SLUG = "zoho-campaigns";
export const ZOHO_CAMPAIGNS_PROVIDER = "zoho-campaigns";
const ACCOUNTS_ROOT = "https://accounts.zoho.com";
const API_ROOT = "https://campaigns.zoho.com/api/v1.1";
const REQUEST_TIMEOUT_MS = 30_000;
const REQUIRED_FIELDS = ["clientId", "clientSecret", "refreshToken"] as const;

const CATALOG_QUERY_NEEDLES = ["zoho", "campaign", "campaigns", "email", "draft"];

const tools: ConnectorTool[] = [
  {
    name: "zoho_campaigns_list_lists",
    description: "List Zoho Campaigns mailing lists and list keys. Read-only.",
    readOnly: true,
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "zoho_campaigns_list_topics",
    description: "List Zoho Campaigns topics. Read-only. Some accounts need a topic id on drafts.",
    readOnly: true,
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "zoho_campaigns_create_draft",
    description:
      "Create a Zoho Campaigns draft from a public content_url. Never sends or schedules. Ask before calling.",
    inputSchema: {
      type: "object",
      properties: {
        campaignName: { type: "string", minLength: 1 },
        subject: { type: "string", minLength: 1 },
        fromEmail: { type: "string", minLength: 1 },
        fromName: { type: "string", minLength: 1 },
        contentUrl: { type: "string", minLength: 8 },
        listKeys: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        topicId: { type: "string" },
      },
      required: ["campaignName", "subject", "fromEmail", "fromName", "contentUrl", "listKeys"],
      additionalProperties: false,
    },
  },
];

export type ZohoCampaignsCredentialLoader = (
  workspaceId: string,
) => Promise<WorkspaceCredentialFields | null>;

export type ZohoCampaignsWorkspaceResolver = (context: AdapterContext) => Promise<string | null>;

export interface ZohoCampaignsConnectorDependencies {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  resolveWorkspaceId?: ZohoCampaignsWorkspaceResolver;
  loadCredential?: ZohoCampaignsCredentialLoader;
  fetch?: typeof fetch;
}

export class ZohoCampaignsConnector implements ManagedConnectorProvider {
  constructor(private readonly dependencies: ZohoCampaignsConnectorDependencies) {}

  describe() {
    return {
      id: ZOHO_CAMPAIGNS_CONNECTOR_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: false, secretsBrokered: true },
    };
  }

  async catalog(context: AdapterContext, query?: string): Promise<ConnectorCatalogItem[]> {
    if (!matchesCatalogQuery(query)) return [];
    return [
      {
        connectorId: ZOHO_CAMPAIGNS_CONNECTOR_ID,
        slug: ZOHO_CAMPAIGNS_SLUG,
        name: "Zoho Campaigns",
        logo: null,
        connected: await this.hasCredential(context),
        noAuth: true,
      },
    ];
  }

  async listConnectedExternalIds(context: AdapterContext): Promise<string[]> {
    return (await this.hasCredential(context)) ? [ZOHO_CAMPAIGNS_SLUG] : [];
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    if (!(await this.hasCredential(context))) return [];
    return tools.map((tool) => ({
      ...tool,
      route: {
        connectorId: ZOHO_CAMPAIGNS_CONNECTOR_ID,
        resourceId: ZOHO_CAMPAIGNS_SLUG,
        toolName: tool.name,
      },
    }));
  }

  async begin(
    _request: { provider: string; redirectUrl: string },
    context: AdapterContext,
  ): Promise<{ authorizationUrl: null; state: string }> {
    if (!(await this.hasCredential(context))) {
      throw new Error(
        "Zoho Campaigns is not connected in Workspace Settings. Save the existing clientId, clientSecret, and refreshToken there first.",
      );
    }
    return { authorizationUrl: null, state: ZOHO_CAMPAIGNS_SLUG };
  }

  async complete(): Promise<{ connectionRef: string }> {
    return { connectionRef: ZOHO_CAMPAIGNS_SLUG };
  }

  async connectionReady(context: AdapterContext): Promise<boolean> {
    return this.hasCredential(context);
  }

  async revoke(): Promise<void> {
    // Keep the workspace ingest credential. Integrations revoke only drops the connection row.
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    const secrets: string[] = [];
    try {
      const credential = await this.requireCredential(context);
      const token = await this.accessToken(credential, context);
      secrets.push(token, credential.clientId, credential.clientSecret, credential.refreshToken);
      const result = await this.executeTool(
        call.route?.toolName ?? call.tool,
        call.args,
        token,
        credential,
        context,
      );
      yield { type: "result", data: redactConnectorPayload(result, secrets) };
    } catch (error) {
      yield { type: "error", message: sanitizeConnectorError(error, secrets) };
    }
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    token: string,
    credential: WorkspaceCredentialFields,
    context: AdapterContext,
  ): Promise<unknown> {
    if (name === "zoho_campaigns_list_lists") {
      return this.zohoCall(token, credential, "getmailinglists", { resfmt: "JSON" }, context);
    }
    if (name === "zoho_campaigns_list_topics") {
      return this.zohoCall(token, credential, "topics", { from_index: "1", range: "100" }, context);
    }
    if (name === "zoho_campaigns_create_draft") {
      const campaignName = requiredString(args.campaignName, "campaignName");
      const subject = requiredString(args.subject, "subject");
      const fromEmail = requiredString(args.fromEmail, "fromEmail");
      const fromName = requiredString(args.fromName, "fromName");
      const contentUrl = requiredHttpsUrl(args.contentUrl, "contentUrl");
      const listKeys = stringArray(args.listKeys, "listKeys");
      const topicId = optionalString(args.topicId, "topicId");
      const params: Record<string, string> = {
        resfmt: "JSON",
        campaignname: campaignName,
        from_email: fromEmail,
        from_name: fromName,
        subject,
        content_url: contentUrl,
        list_details: JSON.stringify(Object.fromEntries(listKeys.map((key) => [key, []]))),
      };
      if (topicId) params.topicId = topicId;
      const body = await this.zohoCall(
        token,
        credential,
        "createCampaign",
        params,
        context,
        "POST",
      );
      return {
        draft: true,
        sent: false,
        campaignName,
        subject,
        campaignKey: pickCampaignKey(body),
      };
    }
    throw new Error(`Unknown Zoho Campaigns tool ${name}`);
  }

  private async hasCredential(context: AdapterContext): Promise<boolean> {
    const fields = await this.loadFields(context);
    return Boolean(fields && hasRequiredCampaignsFields(fields));
  }

  private async requireCredential(context: AdapterContext): Promise<WorkspaceCredentialFields> {
    const fields = await this.loadFields(context);
    if (!fields || !hasRequiredCampaignsFields(fields)) {
      throw new Error(
        "Zoho Campaigns is not connected in Workspace Settings. Save the existing clientId, clientSecret, and refreshToken there first.",
      );
    }
    return fields;
  }

  private async loadFields(context: AdapterContext): Promise<WorkspaceCredentialFields | null> {
    const workspaceId = await this.resolveWorkspaceId(context);
    if (!workspaceId) return null;
    if (this.dependencies.loadCredential) {
      return this.dependencies.loadCredential(workspaceId);
    }
    return loadWorkspaceCredential(
      this.dependencies.prisma,
      this.dependencies.secrets,
      workspaceId,
      ZOHO_CAMPAIGNS_PROVIDER,
    );
  }

  private async resolveWorkspaceId(context: AdapterContext): Promise<string | null> {
    if (this.dependencies.resolveWorkspaceId) {
      return this.dependencies.resolveWorkspaceId(context);
    }
    try {
      const workspace = await workspaceForAgent(this.dependencies.prisma, {
        spaceId: context.spaceId,
        userId: context.userId,
      });
      return workspace?.id ?? null;
    } catch (error) {
      if (error instanceof IsolationError) return null;
      throw error;
    }
  }

  private async accessToken(
    credential: WorkspaceCredentialFields,
    context: AdapterContext,
  ): Promise<string> {
    const accounts = credential.accountsRoot?.trim() || ACCOUNTS_ROOT;
    const response = await this.fetch(`${accounts.replace(/\/$/, "")}/oauth/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: credential.clientId,
        client_secret: credential.clientSecret,
        refresh_token: credential.refreshToken,
      }),
      signal: combineSignals(context.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
    });
    const body = (await response.json().catch(() => undefined)) as
      | { access_token?: string; error?: string }
      | undefined;
    if (!response.ok || !body?.access_token) {
      throw new Error("Zoho Campaigns token refresh failed. Check the workspace credential.");
    }
    return body.access_token;
  }

  private async zohoCall(
    token: string,
    credential: WorkspaceCredentialFields,
    path: string,
    params: Record<string, string>,
    context: AdapterContext,
    method: "GET" | "POST" = "GET",
  ): Promise<Record<string, unknown>> {
    const root = (credential.apiRoot?.trim() || API_ROOT).replace(/\/$/, "");
    const encoded = new URLSearchParams(params);
    const url = method === "GET" ? `${root}/${path}?${encoded}` : `${root}/${path}`;
    const response = await this.fetch(url, {
      method,
      headers: {
        authorization: `Zoho-oauthtoken ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: method === "POST" ? encoded : undefined,
      signal: combineSignals(context.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
    });
    const body = (await response.json().catch(() => undefined)) as
      | { code?: string; status?: string; message?: string }
      | undefined;
    if (!response.ok || !body || zohoFailed(body)) {
      throw new Error(body?.message || "Zoho Campaigns request failed.");
    }
    return body as Record<string, unknown>;
  }

  private fetch(url: string, init: RequestInit) {
    return (this.dependencies.fetch ?? globalThis.fetch)(url, init);
  }
}

function hasRequiredCampaignsFields(fields: WorkspaceCredentialFields): boolean {
  return REQUIRED_FIELDS.every((key) => Boolean(fields[key]?.trim()));
}

function matchesCatalogQuery(query?: string): boolean {
  const needle = query?.trim().toLowerCase();
  if (!needle) return true;
  return CATALOG_QUERY_NEEDLES.some((token) => needle.includes(token) || token.includes(needle));
}

function zohoFailed(body: { code?: string; status?: string }): boolean {
  const code = String(body.code ?? "0");
  const status = String(body.status ?? "").toLowerCase();
  return (code !== "0" && code !== "200") || status === "error";
}

function pickCampaignKey(body: Record<string, unknown>): string | undefined {
  for (const key of ["campaignKey", "campaignkey", "campaign_key"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value.trim() || undefined;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must not be empty`);
  return value.map((entry, index) => requiredString(entry, `${name}[${index}]`));
}

function requiredHttpsUrl(value: unknown, name: string): string {
  const url = requiredString(value, name);
  if (!/^https:\/\//i.test(url)) throw new Error(`${name} must be a public https URL`);
  return url;
}
