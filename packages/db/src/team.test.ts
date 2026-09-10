import { TEAM_ACTIVE_MS } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createTeamRepos } from "./team.js";

const actor = {
  userId: "viewer",
  organizationId: "team-a",
  spaceId: "space-a",
  email: "viewer@example.test",
  isDeploymentOwner: false,
};
const now = new Date("2026-09-10T12:00:00Z");
function fixture() {
  const member = {
    findUnique: vi.fn().mockResolvedValue({ id: "membership" }),
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  return { member, repos: createTeamRepos({ member } as never) };
}
describe("organization team activity", () => {
  it("rejects a removed member before reading or writing activity", async () => {
    const { member, repos } = fixture();
    member.findUnique.mockResolvedValue(null);
    await expect(repos.list(actor, now)).rejects.toThrow("Resource not found");
    await expect(repos.heartbeat(actor, now)).rejects.toThrow("Resource not found");
    expect(member.findMany).not.toHaveBeenCalled();
    expect(member.updateMany).not.toHaveBeenCalled();
  });
  it("scopes reads and heartbeats to the caller's organization and throttles writes", async () => {
    const { member, repos } = fixture();
    await repos.list(actor, now);
    await repos.heartbeat(actor, now);
    expect(member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "team-a" } }),
    );
    expect(member.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "team-a",
        userId: "viewer",
        OR: [{ lastActiveAt: null }, { lastActiveAt: { lte: new Date(now.getTime() - 30_000) } }],
      },
      data: { lastActiveAt: now },
    });
  });
  it("expires activity, requires a live session, and does not invent historical sign-ins", async () => {
    const { member, repos } = fixture();
    const row = (id: string, age: number | null, sessions = [{ id: "session" }]) => ({
      userId: id,
      role: "member",
      lastActiveAt: age === null ? null : new Date(now.getTime() - age),
      user: { name: id, lastSignedInAt: null, sessions },
    });
    member.findMany.mockResolvedValue([
      row("active", TEAM_ACTIVE_MS - 1),
      row("expired", TEAM_ACTIVE_MS),
      row("signed-out", 0, []),
      row("never", null),
      row("future", -1),
    ] as never);
    const result = await repos.list(actor, now);
    expect(result.map((m) => m.active)).toEqual([true, false, false, false, false]);
    expect(result.every((m) => m.lastSignedInAt === null)).toBe(true);
    expect(result[0]).not.toHaveProperty("sessions");
  });
});
