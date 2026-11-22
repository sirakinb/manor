import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { isAdmin } from "./admins.js";

describe("isAdmin", () => {
  const users = [
    { id: "verified", email: "Admin@Example.test", emailVerified: true },
    { id: "unverified", email: "admin@example.test", emailVerified: false },
    { id: "owner", email: "owner@example.test", emailVerified: true },
    { id: "space-account", email: "space@example.test", emailVerified: true },
  ];
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.find((user) => user.id === where.id) ?? null,
    },
    deploymentSettings: { findUnique: async () => ({ ownerUserId: "owner" }) },
  } as unknown as PrismaClient;
  const person = (userId: string) => ({ userId, isDeploymentOwner: userId === "owner" });

  it("requires a listed, verified email", async () => {
    const deps = { prisma, env: { adminEmails: ["admin@example.test"] } as never };
    expect(await isAdmin(deps, person("verified"))).toBe(true);
    expect(await isAdmin(deps, person("unverified"))).toBe(false);
    expect(await isAdmin({ prisma, env: {} as never }, person("verified"))).toBe(false);
  });

  it("counts Manor's deployment owner without any listed email", async () => {
    expect(await isAdmin({ prisma, env: {} as never }, person("owner"))).toBe(true);
  });

  it("checks the signed-in person in a shared team space, not the space account", async () => {
    const deps = { prisma, env: {} as never };
    // The space account's actor never carries isDeploymentOwner; the initiator is looked up.
    const inTeamSpace = (initiatedByUserId: string) => ({
      userId: "space-account",
      initiatedByUserId,
      isDeploymentOwner: false,
    });
    expect(await isAdmin(deps, inTeamSpace("owner"))).toBe(true);
    expect(await isAdmin(deps, inTeamSpace("verified"))).toBe(false);
    const listed = { prisma, env: { adminEmails: ["admin@example.test"] } as never };
    expect(await isAdmin(listed, inTeamSpace("verified"))).toBe(true);
  });
});
