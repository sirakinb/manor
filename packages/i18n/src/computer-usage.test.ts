import { i18n } from "@lingui/core";
import { expect, it } from "vitest";
import { computerLabel, computerName, computerUsageDetails } from "./computer-usage.js";

it("shows a failed refresh in place of the previously loaded hours", () => {
  i18n.activate("en");
  const data = { computers: [], otherHours: 2 };
  expect(computerUsageDetails({ data, isError: false }, "en").rows).toHaveLength(1);
  expect(computerUsageDetails({ data, isError: true }, "en")).toEqual({
    rows: [],
    message: "Could not load computer hours",
  });
});

it("names a This Mac computer by its shared folder", () => {
  i18n.activate("en");
  expect(computerLabel("local", "Maya")).toBe("Shared folder on this Mac");
  expect(computerName({ scope: "local", botName: "Maya" })).toBe("Shared folder on this Mac");
  expect(computerLabel("dedicated", "Maya")).toBe("Maya’s computer");
  expect(computerLabel("team", "Maya")).toBe("Team Computer");
  expect(computerName({ scope: "dedicated", botName: "Maya" })).toBe("Maya");
});
