import { ORPCError } from "@orpc/server";
import type { OrganizationList } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  assertOrganizationChangesAvailable,
  ORGANIZATION_CHANGES_AVAILABLE,
  ORGANIZATIONS_UNAVAILABLE,
  permittedOrganizations,
} from "./organization-availability.js";

const organization = (id: string) => ({
  id,
  name: id,
  defaultSpaceId: id,
  spaceIds: [id],
  canManage: true,
});

const list: OrganizationList = {
  activeOrganizationId: "org-personal",
  organizations: [
    organization("org-personal"),
    organization("org-client"),
    organization("org-side"),
  ],
};

describe("organization availability", () => {
  it("is off on this deployment", () => {
    expect(ORGANIZATION_CHANGES_AVAILABLE).toBe(false);
  });

  it("refuses adding or switching organizations with a typed error", () => {
    let caught: unknown;
    try {
      assertOrganizationChangesAvailable();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ORPCError);
    expect(caught).toMatchObject({
      code: "FORBIDDEN",
      message: "Adding or switching organizations is not available on this deployment.",
      data: { reason: ORGANIZATIONS_UNAVAILABLE },
    });
  });

  it("lists only the main portal's organization", () => {
    const actor = { organizationId: "org-personal", portalOrganizationId: "org-personal" };
    expect(permittedOrganizations(list, actor).organizations.map((org) => org.id)).toEqual([
      "org-personal",
    ]);
  });

  it("lists only the brand's organization on its portal", () => {
    const actor = { organizationId: "org-client", portalOrganizationId: "org-client" };
    expect(permittedOrganizations(list, actor)).toEqual({
      activeOrganizationId: "org-personal",
      organizations: [organization("org-client")],
    });
  });

  it("falls back to the actor's organization without a portal", () => {
    expect(
      permittedOrganizations(list, { organizationId: "org-side" }).organizations.map(
        (org) => org.id,
      ),
    ).toEqual(["org-side"]);
  });

  it("lets a lifted flag through and lists every organization", () => {
    expect(() => assertOrganizationChangesAvailable(true)).not.toThrow();
    expect(permittedOrganizations(list, { organizationId: "org-side" }, true)).toBe(list);
  });
});
