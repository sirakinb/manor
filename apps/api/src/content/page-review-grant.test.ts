import type { Actor } from "@rakazo/contracts";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { grantPage } from "./page-collaboration.js";

const owner: Actor = {
  userId: "owner-1",
  spaceId: "space-1",
  organizationId: "org-1",
  email: "owner@example.test",
  isDeploymentOwner: false,
};

/** Accounts on the deployment, with the organizations each belongs to. */
const accounts = [
  { id: "colleague-1", email: "colleague@example.test", organizations: ["org-1"] },
  { id: "outsider-1", email: "outsider@example.test", organizations: ["org-2"] },
  { id: "person-1", email: "person@example.test", organizations: ["org-1"] },
];

type UserWhere = {
  email: { equals: string };
  members?: { some: { organizationId: string } };
};

function fixture(actor: Actor) {
  const upsert = vi.fn(async () => ({ id: "grant-1" }));
  const findMany = vi.fn(async ({ where }: { where: UserWhere }) =>
    accounts
      .filter((account) => account.email === where.email.equals.toLowerCase())
      .filter(
        (account) =>
          !where.members || account.organizations.includes(where.members.some.organizationId),
      )
      .map(({ id }) => ({ id })),
  );
  const tx = {
    $queryRaw: vi.fn(async () => []),
    page: {
      findFirst: vi.fn(async () => ({
        id: "page-1",
        userId: actor.userId,
        spaceId: actor.spaceId,
        visibility: "people",
        currentVersion: 2,
        title: "Plan",
        user: { deactivatedAt: null },
        bot: null,
        grants: [],
      })),
    },
    space: { findUniqueOrThrow: vi.fn(async () => ({ organizationId: "org-1" })) },
    pageGrant: {
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      upsert,
    },
    user: { findMany },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  } as unknown as PrismaClient;
  const publishSpaceChange = vi.fn(async () => undefined);
  const events = { publishSpaceChange } as unknown as ThreadEvents;
  const grant = (email: string, pageReviewOutsideOrganizationAvailable?: boolean) =>
    grantPage({ prisma, events, pageReviewOutsideOrganizationAvailable }, actor, {
      pageId: "page-1",
      email,
    });
  const bound = () => (upsert.mock.calls.at(-1) as unknown as [{ create: object }])[0].create;
  return { grant, bound, publishSpaceChange };
}

describe("sharing a page for review with specific people", () => {
  it("binds a reviewer in the page's organization", async () => {
    const { grant, bound } = fixture(owner);
    await expect(grant("colleague@example.test")).resolves.toEqual({
      id: "grant-1",
      email: "colleague@example.test",
    });
    expect(bound()).toMatchObject({ userId: "colleague-1", bound: true });
  });

  it("answers an address in another organization exactly like one with no account", async () => {
    const { grant, bound, publishSpaceChange } = fixture(owner);
    const outside = await grant("outsider@example.test");
    const outsideGrant = bound();
    const outsideSignals = publishSpaceChange.mock.calls.length;
    const unknown = await grant("nobody@example.test");
    expect(outside).toEqual({ id: "grant-1", email: "outsider@example.test" });
    expect(unknown).toEqual({ id: "grant-1", email: "nobody@example.test" });
    expect(outsideGrant).toMatchObject({ userId: null, bound: false });
    expect(bound()).toMatchObject({ userId: null, bound: false });
    // Only the owner is told, in both cases: nothing reaches the other organization's account.
    expect(outsideSignals).toBe(1);
    expect(publishSpaceChange.mock.calls.length).toBe(2);
  });

  it("lets a team space's shared account share with a person member of its organization", async () => {
    const { grant, bound } = fixture({
      ...owner,
      userId: "space-account",
      initiatedByUserId: "person-1",
    });
    await grant("person@example.test");
    expect(bound()).toMatchObject({ userId: "person-1", bound: true });
  });

  it("keeps upstream's behaviour with the limit lifted", async () => {
    const { grant, bound } = fixture(owner);
    await grant("outsider@example.test", true);
    expect(bound()).toMatchObject({ userId: "outsider-1", bound: true });
  });
});
