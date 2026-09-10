import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { assertPortalAccess, portalBrandId, requirePortalMembership } from "./portal.js";

const clientHost = "jrhmanor.agentworkspace.cloud";
function fixture(assigned: string | null = "jrh", member = true) {
  return {
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ portalBrandId: assigned }) },
    member: {
      findFirst: vi.fn().mockResolvedValue(member ? { organizationId: "client-org" } : null),
    },
    spaceMember: { findFirst: vi.fn().mockResolvedValue(null) },
  };
}
describe("client portal access", () => {
  it("uses Host ahead of caller-supplied Origin and forwarded headers", () => {
    expect(
      portalBrandId(
        new Headers({
          host: "manor.pentridgemedia.com",
          origin: `https://${clientHost}`,
          "x-forwarded-host": clientHost,
        }),
      ),
    ).toBeNull();
    expect(portalBrandId(new Headers({ host: `${clientHost}:443` }))).toBe("jrh");
  });
  it("requires an assigned client's portal on every session request", async () => {
    const prisma = fixture() as unknown as PrismaClient;
    await expect(
      assertPortalAccess(prisma, "client", new Headers({ host: "manor.pentridgemedia.com" })),
    ).rejects.toThrow("Use your organization's sign-in page.");
    await expect(
      assertPortalAccess(prisma, "client", new Headers({ host: clientHost })),
    ).resolves.toBe("client-org");
  });
  it("does not admit an unrelated main account to a client portal", async () => {
    await expect(
      assertPortalAccess(
        fixture(null, false) as unknown as PrismaClient,
        "unrelated",
        new Headers({ host: clientHost }),
      ),
    ).rejects.toThrow("This account cannot access this portal.");
  });
  it("resolves the main account's first unbranded organization independently of the space header", async () => {
    const prisma = fixture(null);
    prisma.member.findFirst.mockResolvedValue({ organizationId: "main-org" });
    await expect(
      assertPortalAccess(
        prisma as unknown as PrismaClient,
        "admin",
        new Headers({
          host: "manor.pentridgemedia.com",
          "x-rakazo-space-id": "client-space",
        }),
      ),
    ).resolves.toBe("main-org");
    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: { userId: "admin", organization: { brandId: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { organizationId: true },
    });
  });
  it("rejects a client space on the main portal even for an administrator", async () => {
    const prisma = fixture(null);
    prisma.member.findFirst.mockResolvedValue({ organizationId: "main-org" });
    await expect(
      requirePortalMembership(
        prisma as unknown as PrismaClient,
        "admin",
        new Request("https://manor.pentridgemedia.com/rpc/me", {
          headers: { host: "manor.pentridgemedia.com", "x-rakazo-space-id": "client-space" },
        }),
      ),
    ).rejects.toThrow();
    expect(prisma.spaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "admin",
          spaceId: "client-space",
          organizationId: "main-org",
          member: { user: { isSpaceAccount: false } },
        },
      }),
    );
  });
  it("denies the main portal when there is no main-portal organization", async () => {
    await expect(
      assertPortalAccess(
        fixture(null, false) as unknown as PrismaClient,
        "client-admin",
        new Headers({ host: "manor.pentridgemedia.com" }),
      ),
    ).rejects.toThrow("This account cannot access this portal.");
  });
  it("restricts even an administrator's requested space to the portal organization", async () => {
    const prisma = fixture(null);
    await expect(
      requirePortalMembership(
        prisma as unknown as PrismaClient,
        "admin",
        new Request(`https://${clientHost}/rpc/me`, {
          headers: { host: clientHost, "x-rakazo-space-id": "personal-space" },
        }),
      ),
    ).rejects.toThrow();
    expect(prisma.spaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "admin",
          spaceId: "personal-space",
          organizationId: "client-org",
          member: { user: { isSpaceAccount: false } },
        },
      }),
    );
  });
});
