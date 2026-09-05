import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeWorkspaceTool, InMemoryRealtimeFanout } from "@rakazo/adapters";
import { INTEGRATION_SCOPES, WORKSPACE_EXTERNAL_TOOL_NAMES } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";
const describeDb =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;

describeDb("external workspace handoff", () => {
  let handles: Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts").createApp>>;
  let cookie: string;
  let token: string;
  let workspaceId: string;
  let owner: { spaceId: string; userId: string; integrationId: string };
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "workspace-handoff-"));
  async function mint(scopes: string[]) {
    const response = await handles.app.request("/v1/integration-credentials", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "External analyst", scopes }),
    });
    expect(response.status).toBe(201);
    return response.json() as Promise<{ id: string; token: string }>;
  }
  async function call(name: string, args: unknown = {}, credential = token) {
    return handles.app.request(`/v1/workspace/tools/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
  }
  async function mcp(method: string, params: unknown, credential = token) {
    return handles.app.request("/mcp/workspace", {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  }
  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      encryptionKey: "offline-workspace-test-key",
      signupsEnabled: "true",
      realtime: new InMemoryRealtimeFanout(),
    });
    const signup = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        email: `handoff-${stamp}@rakazo.test`,
        password: "password12",
        name: "Workspace Analyst",
      }),
    });
    expect(signup.status).toBe(200);
    cookie = sessionCookieHeader(signup);
    const created = await mint([...INTEGRATION_SCOPES]);
    token = created.token;
    const row = await handles.prisma.integrationCredential.findUniqueOrThrow({
      where: { id: created.id },
    });
    owner = { spaceId: row.spaceId, userId: row.createdByUserId, integrationId: row.id };
    const space = await handles.prisma.space.findUniqueOrThrow({ where: { id: owner.spaceId } });
    const workspace = await handles.prisma.workspace.create({
      data: {
        organizationId: space.organizationId,
        name: "Test Operations",
        slug: `handoff-${stamp}`,
        channels: ["voice", "email", "utilities"],
      },
    });
    workspaceId = workspace.id;
  }, 60_000);
  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("advertises the same granted schemas over MCP, HTTP and OpenAPI", async () => {
    const list = await mcp("tools/list", {});
    expect(list.status).toBe(200);
    const body = (await list.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual(
      [...WORKSPACE_EXTERNAL_TOOL_NAMES].sort(),
    );
    expect(body.result.tools.some((tool) => tool.name === "workspace_run_automation")).toBe(false);
    const catalog = await handles.app.request("/v1/workspace/tools", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(((await catalog.json()) as { tools: unknown[] }).tools).toHaveLength(
      WORKSPACE_EXTERNAL_TOOL_NAMES.length,
    );
    const spec = (await (await handles.app.request("/v1/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };
    for (const name of WORKSPACE_EXTERNAL_TOOL_NAMES)
      expect(spec.paths).toHaveProperty(`/v1/workspace/tools/${name}`);
  });

  it("reads context across transports and prevents lost updates under concurrency", async () => {
    const created = await call("workspace_set_context", {
      key: "reporting",
      content: "Original",
      expectedUpdatedAt: null,
    });
    expect(created.status).toBe(200);
    const entry = (await created.json()) as { updatedAt: string };
    const result = await mcp("tools/call", {
      name: "workspace_get_context",
      arguments: { keys: ["reporting"] },
    });
    const body = (await result.json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(body.result.content[0]!.text)).toEqual([
      expect.objectContaining({ key: "reporting", content: "Original" }),
    ]);
    const responses = await Promise.all(
      ["First edit", "Second edit"].map((content) =>
        call("workspace_set_context", {
          key: "reporting",
          content,
          expectedUpdatedAt: entry.updatedAt,
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const native = await executeWorkspaceTool(
      { prisma: handles.prisma },
      {
        spaceId: owner.spaceId,
        userId: owner.userId,
        botId: "read-only-context",
        executionId: "read-1",
      },
      "workspace_get_context",
      { keys: ["reporting"] },
    );
    expect(native).toEqual([
      expect.objectContaining({ key: "reporting", content: expect.stringMatching(/edit$/) }),
    ]);
  });

  it("versions skills, replays saves and rejects competing edits", async () => {
    const input = { name: "report-playbook", content: "Read current data", expectedVersion: 0 };
    expect((await call("workspace_save_skill", input)).status).toBe(200);
    expect((await call("workspace_save_skill", input)).status).toBe(200);
    expect(
      await handles.prisma.workspaceSkill.count({ where: { workspaceId, name: input.name } }),
    ).toBe(1);
    const races = await Promise.all(
      ["New A", "New B"].map((content) =>
        call("workspace_save_skill", { ...input, content, expectedVersion: 1 }),
      ),
    );
    expect(races.map((response) => response.status).sort()).toEqual([200, 409]);
    const original = await call("workspace_get_skill", { name: input.name, version: 1 });
    expect(await original.json()).toMatchObject({ content: input.content, version: 1 });
  });

  it("records attributed outcomes without accepting approval claims or duplicating retries", async () => {
    const input = {
      channel: "email",
      title: "Analysis completed",
      summary: "Saved findings",
      status: "completed",
      idempotencyKey: "platform:run-1:analysis",
      evidence: {
        platform: "test-platform",
        artifacts: [{ label: "Analysis", url: "https://example.com/report" }],
      },
    };
    const first = await call("workspace_log_activity", input);
    expect(first.status).toBe(200);
    const result = (await first.json()) as { activityId: string };
    expect(await (await call("workspace_log_activity", input)).json()).toEqual(result);
    expect(
      (await call("workspace_log_activity", { ...input, summary: "Different payload" })).status,
    ).toBe(409);
    expect(
      (await call("workspace_log_activity", { ...input, verification: "approved" })).status,
    ).toBe(400);
    expect(
      (await call("workspace_log_activity", { ...input, idempotencyKey: undefined })).status,
    ).toBe(400);
    const row = await handles.prisma.workspaceActivity.findUniqueOrThrow({
      where: { id: result.activityId },
    });
    expect(row).toMatchObject({
      actor: "External analyst",
      verification: "pending",
      verifiedBy: null,
      payload: { source: "external", integrationId: owner.integrationId, evidence: input.evidence },
    });
    const history = (await (await call("workspace_activities")).json()) as unknown[];
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: result.activityId,
          source: "external",
          evidence: input.evidence,
        }),
      ]),
    );
  });

  it("enforces scope, strict inputs, revocation and expiry on both transports", async () => {
    const reader = await mint(["workspace:read"]);
    const denied = await call(
      "workspace_set_context",
      { key: "blocked", content: "No", expectedUpdatedAt: null },
      reader.token,
    );
    expect(denied.status).toBe(403);
    const listed = (await (await mcp("tools/list", {}, reader.token)).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(listed.result.tools.map((tool) => tool.name)).not.toContain("workspace_set_context");
    const mcpDenied = (await (
      await mcp(
        "tools/call",
        {
          name: "workspace_set_context",
          arguments: { key: "blocked", content: "No", expectedUpdatedAt: null },
        },
        reader.token,
      )
    ).json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(Boolean(mcpDenied.error || mcpDenied.result?.isError)).toBe(true);
    expect(
      (await call("workspace_get_context", { organizationId: "another-organization" })).status,
    ).toBe(400);
    expect((await call("workspace_run_automation", { key: "recap" })).status).toBe(404);
    await handles.prisma.integrationCredential.update({
      where: { id: reader.id },
      data: { expiresAt: new Date(0) },
    });
    expect((await call("workspace_get_context", {}, reader.token)).status).toBe(401);
    await handles.prisma.integrationCredential.update({
      where: { id: reader.id },
      data: { expiresAt: null, revokedAt: new Date() },
    });
    expect((await mcp("tools/list", {}, reader.token)).status).toBe(401);
  });

  it("cannot read a different organization's report or skills and loses access with membership", async () => {
    const foreignOrg = await handles.prisma.organization.create({
      data: {
        id: `isolated-${stamp}`,
        name: "Isolated organization",
        slug: `isolated-${stamp}`,
        createdAt: new Date(),
      },
    });
    const foreign = await handles.prisma.workspace.create({
      data: {
        organizationId: foreignOrg.id,
        name: "Other operations",
        slug: `other-${stamp}`,
        channels: ["voice"],
      },
    });
    const report = await handles.prisma.workspaceReport.create({
      data: {
        workspaceId: foreign.id,
        reportType: "voice",
        title: "Unrelated confidential report",
        status: "draft",
      },
    });
    await handles.prisma.workspaceSkill.create({
      data: {
        workspaceId: foreign.id,
        name: "foreign-playbook",
        content: "Unrelated private content",
        createdBy: "test",
      },
    });
    expect((await call("workspace_report", { reportId: report.id })).status).not.toBe(200);
    expect((await call("workspace_get_skill", { name: "foreign-playbook" })).status).not.toBe(200);
    await handles.prisma.spaceMember.delete({
      where: { spaceId_userId: { spaceId: owner.spaceId, userId: owner.userId } },
    });
    expect((await call("workspace_get_context")).status).toBe(401);
    expect((await mcp("tools/list", {})).status).toBe(401);
  });
});
