import { describe, expect, it, vi } from "vitest";
import type { DirectoryAccountChange } from "./directory.js";
import { directoryIdentity, isReservedDirectoryEmail } from "./directory.js";

type Row = { id: string; email: string; emailVerified: boolean; isSpaceAccount: boolean };

function fixture(rows: Row[]) {
  const changes: DirectoryAccountChange[] = [];
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        return row ? { isSpaceAccount: row.isSpaceAccount } : null;
      }),
    },
  };
  const database = {
    findOne: vi.fn(async ({ where }: { where: { field: string; value: string }[] }) => {
      const [condition] = where;
      const row = rows.find(
        (candidate) =>
          condition && candidate[condition.field as "id" | "email"] === condition.value,
      );
      return row ? { ...row, deactivatedAt: null } : null;
    }),
    findMany: vi.fn(async () => []),
    update: vi.fn(async () => null),
  };
  const identity = directoryIdentity(prisma, (change) => changes.push(change));
  const context = { database } as never;
  const resolve = (email: string) =>
    identity.resolveUser!({ resource: { primaryEmail: email } } as never, context);
  const reconcile = (userId: string, active: boolean) =>
    identity.reconcileUser!({ userId, active } as never, context);
  return { resolve, reconcile, database, changes };
}

describe("directory identity", () => {
  it("treats every .invalid address as reserved", () => {
    expect(isReservedDirectoryEmail("space_1@space.invalid")).toBe(true);
    expect(isReservedDirectoryEmail("msg-abc@messaging.invalid")).toBe(true);
    expect(isReservedDirectoryEmail("Ada@Example.com")).toBe(false);
  });

  it("never links a team space's shared account by its address", async () => {
    const { resolve, database } = fixture([
      { id: "space_1", email: "space_1@space.invalid", emailVerified: true, isSpaceAccount: true },
    ]);
    // A create for a reserved address is then refused by the user hook.
    await expect(resolve("space_1@space.invalid")).resolves.toEqual({ action: "create" });
    expect(database.findOne).not.toHaveBeenCalled();
  });

  it("refuses a space account even when it has an ordinary address", async () => {
    const { resolve } = fixture([
      { id: "space_2", email: "team@example.com", emailVerified: true, isSpaceAccount: true },
    ]);
    await expect(resolve("team@example.com")).rejects.toMatchObject({ status: "CONFLICT" });
  });

  it("links a person's verified account", async () => {
    const { resolve } = fixture([
      { id: "user_1", email: "ada@example.com", emailVerified: true, isSpaceAccount: false },
    ]);
    await expect(resolve("ada@example.com")).resolves.toEqual({
      action: "link",
      userId: "user_1",
      profile: "preserve",
    });
  });

  it("never switches a space account off", async () => {
    const { reconcile, database, changes } = fixture([
      { id: "space_1", email: "space_1@space.invalid", emailVerified: true, isSpaceAccount: true },
      { id: "user_1", email: "ada@example.com", emailVerified: true, isSpaceAccount: false },
    ]);
    await reconcile("space_1", false);
    expect(database.update).not.toHaveBeenCalled();
    expect(changes).toEqual([]);

    await reconcile("user_1", false);
    expect(database.update).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([{ userId: "user_1", active: false, changed: true }]);
  });
});
