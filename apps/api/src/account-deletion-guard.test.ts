import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { AccountDeletionRefusedError, assertAccountDeletable } from "./account-deletion-guard.js";

type Fixture = {
  isSpaceAccount?: boolean;
  managedSpaces?: number;
  organizations?: string[];
  otherMembers?: number;
  workspaces?: number;
  crmContacts?: number;
  publicForms?: number;
};

function client(fixture: Fixture) {
  const count = (value = 0) => vi.fn(async () => value);
  return {
    user: { findUnique: vi.fn(async () => ({ isSpaceAccount: fixture.isSpaceAccount ?? false })) },
    space: { count: count(fixture.managedSpaces) },
    member: {
      findMany: vi.fn(async () =>
        (fixture.organizations ?? ["org-personal"]).map((organizationId) => ({ organizationId })),
      ),
      count: count(fixture.otherMembers),
    },
    workspace: { count: count(fixture.workspaces) },
    crmContact: { count: count(fixture.crmContacts) },
    crmPipeline: { count: count() },
    crmDeal: { count: count() },
    crmModule: { count: count() },
    publicForm: { count: count(fixture.publicForms) },
  } as unknown as PrismaClient;
}

describe("account deletion guard", () => {
  it("allows a sole member of an organization with no business data", async () => {
    await expect(assertAccountDeletable(client({}), "user-1")).resolves.toBeUndefined();
  });

  it("refuses a shared space's account", async () => {
    await expect(
      assertAccountDeletable(client({ isSpaceAccount: true }), "account-1"),
    ).rejects.toThrow("A shared space's account can't be deleted.");
    await expect(
      assertAccountDeletable(client({ managedSpaces: 1 }), "account-1"),
    ).rejects.toBeInstanceOf(AccountDeletionRefusedError);
  });

  it("refuses a member of an organization with other members", async () => {
    await expect(
      assertAccountDeletable(client({ organizations: ["org-team"], otherMembers: 2 }), "user-1"),
    ).rejects.toThrow(/organization other people or business data depend on/);
  });

  it.each([
    ["a Workspace", { workspaces: 1 }],
    ["CRM contacts", { crmContacts: 3 }],
    ["public forms", { publicForms: 1 }],
  ])("refuses a sole member whose organization holds %s", async (_label, data) => {
    await expect(assertAccountDeletable(client(data), "user-1")).rejects.toBeInstanceOf(
      AccountDeletionRefusedError,
    );
  });
});
