import type { PrismaClient } from "@rakazo/db";
import { requireMembership } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { actorFromMembership } from "./request-session.js";

const actor = {
  userId: "user-1",
  spaceId: "space-support",
  organizationId: "org-1",
  email: "owner@example.test",
  isDeploymentOwner: false,
};
const user = { id: actor.userId, email: actor.email };

function prisma(options: { membership: boolean; failure?: Error; ownerUserId?: string }) {
  return {
    spaceMember: {
      findFirst: vi.fn(async () => {
        if (options.failure) throw options.failure;
        return options.membership
          ? {
              userId: actor.userId,
              spaceId: actor.spaceId,
              organizationId: actor.organizationId,
              member: { user: { email: actor.email } },
              // Manor's membership also says whether the space is a shared team space.
              space: { accountUserId: null },
            }
          : null;
      }),
    },
    // Manor keeps the deployment owner (maintenance agent, release controller); upstream #1915
    // dropped it, so Manor's membership lookup still reads the owner seat.
    deploymentSettings: {
      findUnique: vi.fn(async () => ({ ownerUserId: options.ownerUserId ?? "someone-else" })),
    },
  } as unknown as PrismaClient;
}

describe("actorFromMembership", () => {
  it("returns no actor when the user is not a member of the requested Space", async () => {
    await expect(
      actorFromMembership(requireMembership(prisma({ membership: false }), user, "space-other")),
    ).resolves.toBeNull();
  });

  it("returns the actor for a real membership, not the owner unless it holds the seat", async () => {
    const db = prisma({ membership: true });
    await expect(
      actorFromMembership(requireMembership(db, user, "space-support")),
    ).resolves.toEqual(actor);
  });

  it("marks the deployment owner from the stored owner seat", async () => {
    const db = prisma({ membership: true, ownerUserId: "user-1" });
    await expect(
      actorFromMembership(requireMembership(db, user, "space-support")),
    ).resolves.toEqual({ ...actor, isDeploymentOwner: true });
  });

  it("lets a membership query failure surface instead of looking signed out", async () => {
    const failure = new Error("database unavailable");
    await expect(
      actorFromMembership(
        requireMembership(
          prisma({
            membership: true,
            failure,
          }),
          user,
          "space-support",
        ),
      ),
    ).rejects.toBe(failure);
  });
});
