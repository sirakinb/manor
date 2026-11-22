import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./database/client.js";
import { setSpaceSettingOverride } from "./spaces/space-settings.js";

const scope = { spaceId: "space-1", userId: "user-1" };
const member = { spaceId: "space-1", userId: "user-1" };

function fixture(input: {
  overridden: boolean;
  account: { enabled: boolean; skipApprovals: boolean } | null;
}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    spaceSettingOverride: {
      findUnique: vi.fn().mockResolvedValue(input.overridden ? { setting: "confirmations" } : null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
    },
    actionApprovalRule: { deleteMany: vi.fn(), createMany: vi.fn() },
    userActionApprovalRule: { findMany: vi.fn().mockResolvedValue([]) },
    actionAutoReviewPreference: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    userActionAutoReviewPreference: { findUnique: vi.fn().mockResolvedValue(input.account) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
  return { tx, prisma };
}

describe("confirmations override", () => {
  it("keeps the reply-check settings when the override ends", async () => {
    const { tx, prisma } = fixture({ overridden: true, account: null });
    await setSpaceSettingOverride(prisma, scope, "confirmations", false);
    // The Space's row holds Manor's reply check; only the approval rules go.
    expect(tx.actionApprovalRule.deleteMany).toHaveBeenCalledWith({
      where: { spaceId: "space-1", createdByUserId: "user-1" },
    });
    expect(tx.actionAutoReviewPreference.deleteMany).not.toHaveBeenCalled();
    expect(tx.spaceSettingOverride.delete).toHaveBeenCalled();
  });

  it("writes only the mode onto a kept row when the override starts", async () => {
    const { tx, prisma } = fixture({
      overridden: false,
      account: { enabled: false, skipApprovals: true },
    });
    await setSpaceSettingOverride(prisma, scope, "confirmations", true);
    const mode = { enabled: false, skipApprovals: true };
    expect(tx.actionAutoReviewPreference.upsert).toHaveBeenCalledWith({
      where: { spaceId_userId: member },
      create: { ...member, ...mode },
      update: mode,
    });
    expect(tx.actionAutoReviewPreference.create).not.toHaveBeenCalled();
    expect(tx.spaceSettingOverride.create).toHaveBeenCalledWith({
      data: { ...member, setting: "confirmations" },
    });
  });

  it("resets a kept row to the unsaved mode when the account has no preference", async () => {
    const { tx, prisma } = fixture({ overridden: false, account: null });
    await setSpaceSettingOverride(prisma, scope, "confirmations", true);
    expect(tx.actionAutoReviewPreference.updateMany).toHaveBeenCalledWith({
      where: member,
      data: { enabled: true, skipApprovals: false },
    });
    expect(tx.actionAutoReviewPreference.upsert).not.toHaveBeenCalled();
  });
});
