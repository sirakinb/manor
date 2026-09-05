import type { PrismaClient } from "@rakazo/db";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { workspaceAccess } from "./workspace-access.js";
import { mountWorkspaceIntegrationRoutes } from "./workspace-integrations.js";

function fixture(channels: string[] | null = ["voice"]) {
  const prisma = {
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-a", name: "Harbor Homes" }),
    },
    workspace: {
      findUnique: vi.fn().mockResolvedValue(
        channels === null
          ? null
          : {
              id: "ws-a",
              organizationId: "org-a",
              name: "Operations",
              slug: "operations",
              channels,
              activityApproval: "manual",
            },
      ),
    },
    workspaceSource: {
      findMany: vi.fn().mockResolvedValue([{ name: "Voice source", status: "connected" }]),
    },
  };
  const db = prisma as unknown as PrismaClient;
  const app = new Hono();
  mountWorkspaceIntegrationRoutes(app, {
    prisma: db,
    authenticate: async () => ({
      credentialId: "token-a",
      spaceId: "space-a",
      organizationId: "org-a",
      userId: "user-a",
      scopes: ["workspace:read"],
    }),
  });
  return { app, prisma, db };
}

describe("organization API access", () => {
  it("loads identity and sources only from the authenticated organization", async () => {
    const { db, prisma } = fixture();
    const access = await workspaceAccess(db, "org-a");
    expect(access.organization.name).toBe("Harbor Homes");
    expect(prisma.organization.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "org-a" },
      select: { id: true, name: true },
    });
    expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
      where: { organizationId: "org-a" },
    });
    expect(prisma.workspaceSource.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-a" },
      select: { name: true, status: true },
      orderBy: { name: "asc" },
    });
    expect(access.tools).toContain("workspace_voice_calls");
    expect(access.tools).not.toContain("workspace_utilities");
  });

  it("does not advertise workspace tools or sources without a workspace", async () => {
    const { db, prisma } = fixture(null);
    const access = await workspaceAccess(db, "org-a");
    expect(access.workspace).toBeNull();
    expect(access.tools).toEqual([]);
    expect(access.sources).toEqual([]);
    expect(prisma.workspaceSource.findMany).not.toHaveBeenCalled();
  });

  it("keeps HTTP and MCP discovery aligned with enabled channels and token scopes", async () => {
    const { app } = fixture();
    const http = await (await app.request("/v1/workspace/tools")).json();
    const response = await app.request("/mcp/workspace", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(200);
    const mcp = await response.json();
    expect(mcp.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      http.tools.map((tool: { name: string }) => tool.name),
    );
    expect(http.organization.id).toBe("org-a");
    expect(http.tools.map((tool: { name: string }) => tool.name)).not.toContain(
      "workspace_save_skill",
    );
  });

  it("blocks direct HTTP calls to a disabled channel before reading its data", async () => {
    const { app } = fixture();
    const response = await app.request("/v1/workspace/tools/workspace_utilities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden" });
  });
});
