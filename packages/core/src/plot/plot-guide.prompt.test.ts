import { expect, it } from "vitest";
import { PLOT_TOOL_GUIDE } from "./plot-guide.prompt.js";

// Upstream dropped its exact-hash test: the run's prompt version now fingerprints every
// *.prompt.ts file. Manor keeps a check that the guide still teaches its gauge marks.
it("tells the bot how to draw gauges", () => {
  expect(PLOT_TOOL_GUIDE).toContain(
    'Gauges: for a single KPI against its range use {"type": "gauge"}',
  );
  expect(PLOT_TOOL_GUIDE).toContain("bands [{to, color}]");
});
