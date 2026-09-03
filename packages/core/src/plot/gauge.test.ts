import { describe, expect, it } from "vitest";
import { gaugeDials, isGaugeSpec, renderGaugeSvg } from "./gauge.js";
import { renderPlotSpecToSvg, supportedPlotNames } from "./plot-spec.js";

describe("gauge charts", () => {
  it("is listed as a supported mark", () => {
    expect(supportedPlotNames().marks).toContain("gauge");
  });

  it("builds one dial per row when value names a column", () => {
    const dials = gaugeDials(
      {
        marks: [{ type: "gauge", options: { value: "v", max: "cap", label: "name", unit: "%" } }],
      },
      [
        { name: "Occupancy", v: 92, cap: 100 },
        { name: "Renewals", v: 7, cap: 12 },
      ],
    );
    expect(dials).toHaveLength(2);
    expect(dials[0]).toMatchObject({ value: 92, max: 100, label: "Occupancy", unit: "%" });
    expect(dials[1]).toMatchObject({ value: 7, max: 12, label: "Renewals" });
  });

  it("accepts literal numbers and clamps into range when drawing", () => {
    const svg = renderGaugeSvg(
      {
        title: "Server",
        marks: [
          { type: "gauge", options: { value: 140, max: 100, label: "CPU", unit: "%" } },
          { type: "gauge", options: { value: 1.23456, decimals: 2, label: "Load" } },
        ],
      },
      undefined,
    );
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Server");
    expect(svg).toContain("140%");
    expect(svg).toContain("1.23");
    expect(svg).toContain("CPU");
  });

  it("is routed through renderPlotSpecToSvg without needing a DOM", () => {
    const spec = { marks: [{ type: "gauge", options: { value: 55 } }] };
    expect(isGaugeSpec(spec)).toBe(true);
    const svg = renderPlotSpecToSvg(spec, undefined, undefined as unknown as Document);
    expect(svg).toContain("55");
  });

  it("refuses a gauge with no value", () => {
    expect(() =>
      renderGaugeSvg({ marks: [{ type: "gauge", options: {} }] }, undefined),
    ).not.toThrow();
    expect(() => renderGaugeSvg({ marks: [] }, undefined)).toThrow();
  });
});
