import type { Actor } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { routineTestRunNonce } from "./routines.js";

describe("routineTestRunNonce", () => {
  const spaceAccount: Actor = {
    userId: "space-account-1",
    spaceId: "space-1",
    organizationId: "org-1",
    email: "team@rakazo.test",
    isDeploymentOwner: false,
  };

  it("keeps teammates acting through one shared space account apart", () => {
    const first = routineTestRunNonce({ ...spaceAccount, initiatedByUserId: "user-1" }, "n");
    const second = routineTestRunNonce({ ...spaceAccount, initiatedByUserId: "user-2" }, "n");
    expect(first).toBe("routine-run:user-1:n");
    expect(second).toBe("routine-run:user-2:n");
  });

  it("keys a personal space on the account itself", () => {
    expect(routineTestRunNonce({ ...spaceAccount, userId: "user-1" }, "n")).toBe(
      "routine-run:user-1:n",
    );
  });
});
