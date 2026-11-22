import type { PrismaClient } from "@rakazo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listBots = vi.fn();
const createBot = vi.fn();
vi.mock("@rakazo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@rakazo/db")>()),
  createRepos: () => ({ listBots, createBot }),
  importWorkspaceKnowledge: async () => ({ id: "workspace-1", organizationId: "org-1" }),
}));

const { createWorkspaceTeam } = await import("./workspace-team.js");

const actor = {
  organizationId: "org-1",
  spaceId: "space-1",
  userId: "user-1",
  email: "member@example.test",
  isDeploymentOwner: false,
};

describe("workspace team open", () => {
  const findFirst = vi.fn();
  const prisma = { bot: { findFirst } } as unknown as PrismaClient;

  beforeEach(() => {
    listBots.mockReset().mockResolvedValue([]);
    createBot.mockReset().mockResolvedValue({ id: "bot-new" });
    findFirst.mockReset().mockResolvedValue(null);
  });

  it("refuses to replace an archived default instead of creating a second one", async () => {
    findFirst.mockResolvedValueOnce({ id: "bot-archived" });
    await expect(createWorkspaceTeam(prisma).open(actor)).rejects.toThrow(
      "Restore your archived workspace assistant",
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        spaceId: "space-1",
        userId: "user-1",
        spawnKey: "workspace:workspace-1:user-1",
        archivedAt: { not: null },
      },
      select: { id: true },
    });
    expect(createBot).not.toHaveBeenCalled();
  });

  it("creates the default on a member's first open", async () => {
    await expect(createWorkspaceTeam(prisma).open(actor)).resolves.toEqual({ id: "bot-new" });
    expect(createBot).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ spawnKey: "workspace:workspace-1:user-1" }),
    );
  });
});
