import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";

const ensureComputerRecord = vi.hoisted(() => vi.fn(async () => ({ id: "team-computer" })));
vi.mock("@rakazo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@rakazo/db")>()),
  ensureComputerRecord,
}));

import { runLeaseComputerId } from "./run-attempt.js";

const deps = { prisma: {} as PrismaClient };
const thisMac = { computerId: "this-mac", scope: "local", spaceId: "space-1", userId: "user-1" };

// Manor: overnight work, routines and webhooks never run on a laptop that may not be sharing.
describe("runLeaseComputerId", () => {
  it.each(["routine", "webhook"])(
    "leases the team's cloud computer for a This Mac %s run",
    async (trigger) => {
      ensureComputerRecord.mockClear();
      await expect(runLeaseComputerId(deps, { trigger }, thisMac)).resolves.toBe("team-computer");
      expect(ensureComputerRecord).toHaveBeenCalledWith(
        deps.prisma,
        expect.objectContaining({ mode: "team", spaceId: "space-1", userId: "user-1" }),
      );
    },
  );

  it("keeps a person's own run on This Mac", async () => {
    ensureComputerRecord.mockClear();
    await expect(runLeaseComputerId(deps, { trigger: "user" }, thisMac)).resolves.toBe("this-mac");
    expect(ensureComputerRecord).not.toHaveBeenCalled();
  });

  it("keeps any other bot on its own computer", async () => {
    await expect(
      runLeaseComputerId(deps, { trigger: "routine" }, { ...thisMac, scope: "team" }),
    ).resolves.toBe("this-mac");
  });
});
