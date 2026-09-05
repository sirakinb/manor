import { toolRequiresApproval } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { selectBuiltinToolsForRun } from "./executor.js";
import {
  executeWorkspaceTool,
  WORKSPACE_READ_ONLY_TOOL_NAMES,
  workspaceAgentTools,
} from "./workspace-tools.js";

const owner = { spaceId: "space-a", userId: "user-a", botId: "bot-a", executionId: "call-a" };

describe("workspace agent tools", () => {
  it("gates tool exposure and sends mutations through the approval pipeline", () => {
    const options = {
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "user",
      semanticMemoryEnabled: false,
    };
    expect(
      selectBuiltinToolsForRun(options).some((tool) => tool.name.startsWith("workspace_")),
    ).toBe(false);
    expect(
      selectBuiltinToolsForRun({ ...options, workspaceEnabled: true }).filter((tool) =>
        tool.name.startsWith("workspace_"),
      ).length,
    ).toBe(workspaceAgentTools.length);
    expect(toolRequiresApproval("workspace_run_automation", false)).toBe(true);
    expect(WORKSPACE_READ_ONLY_TOOL_NAMES).not.toContain("workspace_run_automation");
    expect(WORKSPACE_READ_ONLY_TOOL_NAMES).not.toContain("workspace_log_activity");
  });
  it("rejects scope overrides, excessive limits and forged verification before touching storage", async () => {
    const prisma = {} as PrismaClient;
    for (const [name, args] of [
      ["workspace_voice_calls", { days: 0 }],
      ["workspace_voice_calls", { limit: 10000 }],
      ["workspace_overview", { organizationId: "other" }],
      [
        "workspace_log_activity",
        { channel: "voice", title: "Done", summary: "Note", verification: "approved" },
      ],
    ] as const) {
      expect(await executeWorkspaceTool({ prisma }, owner, name, args)).toMatchObject({
        error: "Invalid workspace tool arguments.",
      });
    }
  });
  it("refuses a revoked member and an organization without a workspace", async () => {
    const spaceMember = { findUnique: vi.fn().mockResolvedValue(null) };
    const workspace = { findUnique: vi.fn().mockResolvedValue(null) };
    const prisma = { spaceMember, workspace } as unknown as PrismaClient;
    expect(await executeWorkspaceTool({ prisma }, owner, "workspace_overview", {})).toMatchObject({
      error: "Workspace record not found or access denied.",
    });
    expect(workspace.findUnique).not.toHaveBeenCalled();
    spaceMember.findUnique.mockResolvedValue({ organizationId: "org-a" });
    expect(await executeWorkspaceTool({ prisma }, owner, "workspace_overview", {})).toMatchObject({
      error: "No workspace is connected to this organization.",
    });
  });
  it("sanitizes asynchronous repository failures", async () => {
    const prisma = {
      spaceMember: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-a" }) },
      workspace: { findUnique: vi.fn().mockResolvedValue({ id: "ws-a", organizationId: "org-a" }) },
      workspaceReport: {
        findMany: vi.fn().mockRejectedValue(new Error("private database detail")),
      },
    } as unknown as PrismaClient;
    expect(await executeWorkspaceTool({ prisma }, owner, "workspace_reports", {})).toEqual({
      error: "Workspace operation failed. Try again.",
    });
  });
});
