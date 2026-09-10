import { describe, expect, it } from "vitest";
import { parsePortalTeamInput } from "./provision-team.js";

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
