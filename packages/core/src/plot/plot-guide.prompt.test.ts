import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { PLOT_TOOL_GUIDE } from "./plot-guide.prompt.js";

it("keeps the plot guide text exact", () => {
  expect(createHash("sha256").update(PLOT_TOOL_GUIDE).digest("hex")).toMatchInlineSnapshot(
    `"c73d03e7e57bac332e1ffac7c461d173aab0256e458bd16f719f81d9b8c6ea0d"`,
  );
});
