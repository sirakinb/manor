import { displayName } from "@rakazo/core";
import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "./client.js";
import { teamComputerUserId } from "./computers.js";
import { loadMessageAuthors } from "./messages.js";
import {
  actsForRunUser,
  assertNotTeamSpace,
  assertSpaceTakesPerson,
  isTeamSpace,
  PERSON_MEMBER,
  SpaceHasPersonError,
  TeamSpaceSharingError,
} from "./team-space.js";
import { markThreadUnreadForMembers, readerUserId } from "./thread-reads.js";

function spaces(accountUserId: string | null, owner: string | null = "owner-1") {
  return {
    space: { findUnique: vi.fn(async () => ({ accountUserId })) },
    spaceMember: {
      findFirst: vi.fn(async () => (owner ? { userId: owner, id: "membership-1" } : null)),
    },
  } as unknown as PrismaClient;
}

describe("Manor team spaces", () => {
  it("keeps a team space's Team Computer on its shared account", async () => {
    const db = spaces("account-1");
    await expect(teamComputerUserId(db, { spaceId: "space-1", userId: "person-1" })).resolves.toBe(
      "account-1",
    );
    expect(db.spaceMember.findFirst).not.toHaveBeenCalled();
  });

  it("keeps a personal space's Team Computer on its owner, as upstream has it", async () => {
    await expect(
      teamComputerUserId(spaces(null, "owner-1"), { spaceId: "space-1", userId: "member-1" }),
    ).resolves.toBe("owner-1");
    await expect(
      teamComputerUserId(spaces(null, null), { spaceId: "space-1", userId: "member-1" }),
    ).resolves.toBe("member-1");
  });

  it("refuses upstream's membership changes on a team space only", async () => {
    await expect(isTeamSpace(spaces("account-1"), "space-1")).resolves.toBe(true);
    await expect(assertNotTeamSpace(spaces("account-1"), "space-1")).rejects.toBeInstanceOf(
      TeamSpaceSharingError,
    );
    await expect(assertNotTeamSpace(spaces(null), "space-1")).resolves.toBeUndefined();
  });

  it("lets a person in the team space act for the shared account's run, and nobody else", async () => {
    const db = spaces("account-1");
    await expect(
      actsForRunUser(db, { spaceId: "space-1", runUserId: "account-1", userId: "account-1" }),
    ).resolves.toBe(true);
    await expect(
      actsForRunUser(db, { spaceId: "space-1", runUserId: "account-1", userId: "person-1" }),
    ).resolves.toBe(true);
    expect(db.spaceMember.findFirst).toHaveBeenCalledWith({
      where: {
        spaceId: "space-1",
        userId: "person-1",
        space: { accountUserId: "account-1" },
        ...PERSON_MEMBER,
      },
      select: { id: true },
    });
    await expect(
      actsForRunUser(spaces(null, null), {
        spaceId: "space-1",
        runUserId: "owner-1",
        userId: "person-2",
      }),
    ).resolves.toBe(false);
  });

  it("shows the signed-in person's read state, not the shared account's", () => {
    expect(readerUserId({ userId: "account-1", initiatedByUserId: "person-1" })).toBe("person-1");
    expect(readerUserId({ userId: "person-1" })).toBe("person-1");
  });

  it("never marks a chat unread for a shared space account", async () => {
    const statements: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => [{ bypass: null, key: null, login: "owner" }]),
      $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
        statements.push(strings.join("?"));
        return 1;
      }),
    } as unknown as Prisma.TransactionClient;
    await markThreadUnreadForMembers(tx, { threadId: "thread-1", spaceId: "space-1", seq: 3 });
    expect(statements.join("\n")).toMatch(/NOT u\."isSpaceAccount"/);
  });

  it("looks authors up as people, named for display, never as a shared account", async () => {
    const findMany = vi.fn(async () => [{ id: "person-1", name: "  Ada  " }]);
    const authors = await loadMessageAuthors({ user: { findMany } } as never, [
      "person-1",
      "account-1",
      null,
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ["person-1", "account-1"] }, isSpaceAccount: false },
      select: { id: true, name: true },
    });
    expect(authors.get("person-1")?.id).toBe("person-1");
    expect(authors.get("person-1")?.name).toBe(displayName("  Ada  ", "Member"));
    expect(authors.has("account-1")).toBe(false);
  });

  it("lets a person into a space only when it is a team space, invite-shared, or empty", async () => {
    const db = (input: { account: string | null; invited: boolean; other: boolean }) =>
      ({
        space: { findUnique: vi.fn(async () => ({ accountUserId: input.account })) },
        spaceInvite: { findFirst: vi.fn(async () => (input.invited ? { id: "invite-1" } : null)) },
        spaceMember: { findFirst: vi.fn(async () => (input.other ? { id: "member-1" } : null)) },
      }) as unknown as PrismaClient;
    const target = { spaceId: "space-1", userId: "person-2" };
    await expect(
      assertSpaceTakesPerson(db({ account: "account-1", invited: false, other: true }), target),
    ).resolves.toBeUndefined();
    await expect(
      assertSpaceTakesPerson(db({ account: null, invited: true, other: true }), target),
    ).resolves.toBeUndefined();
    await expect(
      assertSpaceTakesPerson(db({ account: null, invited: false, other: false }), target),
    ).resolves.toBeUndefined();
    await expect(
      assertSpaceTakesPerson(db({ account: null, invited: false, other: true }), target),
    ).rejects.toBeInstanceOf(SpaceHasPersonError);
  });
});
