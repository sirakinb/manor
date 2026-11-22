import type * as Db from "@rakazo/db";
import { SpaceHasPersonError } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { parsePortalTeamInput, provisionPortalTeam } from "./provision-team.js";

vi.mock("@rakazo/db", async (original) => ({
  ...(await original<typeof Db>()),
  runAsSystem: (_reason: string, work: () => unknown) => work(),
  joinOrganization: vi.fn(),
  createSpaceAccount: vi.fn(),
}));

describe("provisioning input", () => {
  it.each([
    null,
    [],
    {},
    { brandId: "client" },
    { brandId: "client", members: {} },
    { brandId: "client", members: [null] },
    { brandId: "client", members: [{ email: 42, name: "Tester" }] },
  ])("rejects malformed input before database access: %j", (input) => {
    expect(() => parsePortalTeamInput(input)).toThrow("Expected brandId and a members array");
  });
  it("accepts the documented shape", () => {
    const input = {
      brandId: "client",
      members: [{ email: "member@example.test", name: "Tester" }],
    };
    expect(parsePortalTeamInput(input)).toEqual(input);
  });
});

describe("provisioning an existing organization member", () => {
  /** An organization whose default space already exists, with `ada` already its member. */
  function database(space: { accountUserId: string | null; otherPerson: boolean }) {
    const upsert = vi.fn(async () => ({}));
    const tx = {
      organization: { findUnique: vi.fn(async () => ({ id: "org-1" })) },
      space: {
        findFirst: vi.fn(async () => ({ id: "space-1" })),
        findUnique: vi.fn(async () => ({ accountUserId: space.accountUserId })),
      },
      user: { findFirst: vi.fn(async () => ({ id: "ada", portalBrandId: "jrh" })) },
      member: { findUnique: vi.fn(async () => ({ id: "member-ada" })) },
      spaceInvite: { findFirst: vi.fn(async () => null) },
      spaceMember: {
        findFirst: vi.fn(async () => (space.otherPerson ? { id: "member-grace" } : null)),
        upsert,
      },
    };
    const prisma = { $transaction: (work: (client: typeof tx) => unknown) => work(tx) };
    return { prisma: prisma as never, upsert };
  }
  const input = { brandId: "jrh", members: [{ email: "ada@example.test", name: "Ada" }] };

  it("adds them to a team space", async () => {
    const { prisma, upsert } = database({ accountUserId: "space-account", otherPerson: true });
    await provisionPortalTeam(prisma, input);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("never adds a second person to a space that is not a team space", async () => {
    const { prisma, upsert } = database({ accountUserId: null, otherPerson: true });
    await expect(provisionPortalTeam(prisma, input)).rejects.toBeInstanceOf(SpaceHasPersonError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("keeps the one person a non-team space already holds", async () => {
    const { prisma, upsert } = database({ accountUserId: null, otherPerson: false });
    await provisionPortalTeam(prisma, input);
    expect(upsert).toHaveBeenCalledOnce();
  });
});
