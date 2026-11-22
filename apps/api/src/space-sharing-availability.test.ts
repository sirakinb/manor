import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import {
  assertNotTeamSpace,
  assertSpaceSharingAvailable,
  SPACE_SHARING_AVAILABLE,
  SPACE_SHARING_UNAVAILABLE,
} from "./space-sharing-availability.js";

const refused = { code: "FORBIDDEN", status: 403, data: { reason: SPACE_SHARING_UNAVAILABLE } };

function spaces(accountUserId: string | null) {
  return {
    space: { findUnique: async () => ({ accountUserId }) },
  } as unknown as PrismaClient;
}

describe("invite-link sharing", () => {
  it("is off on this deployment and refuses with the sharing reason", () => {
    expect(SPACE_SHARING_AVAILABLE).toBe(false);
    expect(() => assertSpaceSharingAvailable()).toThrow(
      expect.objectContaining({
        ...refused,
        message: "Sharing a Space by invite link is not available on this deployment.",
      }),
    );
  });

  it("allows it once lifted", () => {
    expect(() => assertSpaceSharingAvailable(true)).not.toThrow();
  });

  it("refuses a team space, and allows a space without a shared account", async () => {
    await expect(assertNotTeamSpace(spaces("space-account"), "space-1")).rejects.toMatchObject(
      refused,
    );
    await expect(assertNotTeamSpace(spaces(null), "space-1")).resolves.toBeUndefined();
  });
});
