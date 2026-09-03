import type { PlotSpec } from "./plot-spec.js";

/* Gauge charts for render_plot. Observable Plot has no dial, so a spec whose
   marks are all "gauge" is rendered here as standalone SVG: a 240° arc with
   coloured bands, ticks, a needle, the value large in the centre and the label
   below. Visual language after ThreeUI's performance gauges (MIT), rebuilt as
   flat SVG so it rasterises through the same PNG path as every other chart. */

export type GaugeBand = { to: number; color: string };

export type GaugeOptions = {
  /** Number, or a column name when rows are supplied. */
  value?: number | string;
  /** Number, or a column name. Default 0. */
  min?: number | string;
  /** Number, or a column name. Default 100. */
  max?: number | string;
  /** Text, or a column name. */
  label?: string;
  /** Text, or a column name. */
  unit?: string;
  /** Colour bands from the previous stop (or min) up to `to`. */
  bands?: GaugeBand[];
  /** Fixed decimals for the printed value. */
  decimals?: number;
};

export type GaugeDial = {
  value: number;
  min: number;
  max: number;
  label: string;
  unit: string;
  bands: GaugeBand[];
  decimals: number;
};

const ACCENT = "#7c3aed";
const DIAL_W = 240;
const DIAL_H = 206;
const SWEEP = 240;
const MAX_DIALS = 8;

export function isGaugeSpec(spec: PlotSpec): boolean {
  return (
    Array.isArray(spec.marks) &&
    spec.marks.length > 0 &&
    spec.marks.every((mark) => mark?.type === "gauge")
  );
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolve(
  key: number | string | undefined,
  row: Record<string, unknown> | undefined,
  fallback: number,
): number {
  if (typeof key === "number") return key;
  if (typeof key === "string" && row && key in row) return num(row[key], fallback);
  if (typeof key === "string" && !row) return num(key, fallback);
  return fallback;
}

/** A key names a column when any row carries it; then rows without it print nothing. */
function resolveText(
  key: string | undefined,
  row: Record<string, unknown> | undefined,
  isColumn: (key: string) => boolean,
): string {
  if (!key) return "";
  if (row && isColumn(key)) return row[key] == null ? "" : String(row[key]);
  return key;
}

/** Expand gauge marks (and optional rows) into concrete dials. */
export function gaugeDials(spec: PlotSpec, data: unknown[] | undefined): GaugeDial[] {
  const rows = (data ?? spec.data ?? []).filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
  const dials: GaugeDial[] = [];
  for (const mark of spec.marks ?? []) {
    const options = (mark.options ?? {}) as GaugeOptions;
    const markRows = Array.isArray(mark.data)
      ? mark.data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      : rows;
    const isColumn = (key: string) => markRows.some((row) => key in row);
    const usesRows = typeof options.value === "string" && isColumn(options.value);
    const sources: Array<Record<string, unknown> | undefined> = usesRows ? markRows : [undefined];
    for (const row of sources) {
      const min = resolve(options.min, row, 0);
      const max = resolve(options.max, row, 100);
      const bands = Array.isArray(options.bands)
        ? options.bands
            .filter((band) => band && typeof band === "object")
            .map((band) => ({ to: num(band.to, max), color: String(band.color ?? ACCENT) }))
            .sort((a, b) => a.to - b.to)
        : [];
      dials.push({
        value: resolve(options.value, row, min),
        min,
        max: max > min ? max : min + 1,
        label: resolveText(options.label, row, isColumn),
        unit: resolveText(
          typeof options.unit === "string" ? options.unit : undefined,
          row,
          isColumn,
        ),
        bands,
        decimals: Math.min(4, Math.max(0, num(options.decimals, 0))),
      });
      if (dials.length >= MAX_DIALS) return dials;
    }
  }
  return dials;
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatValue(dial: GaugeDial): string {
  const text = dial.value.toLocaleString("en-US", {
    minimumFractionDigits: dial.decimals,
    maximumFractionDigits: dial.decimals,
  });
  if (!dial.unit) return text;
  if (/^[$€£¥]$/.test(dial.unit)) return `${dial.unit}${text}`;
  return `${text}${dial.unit.length > 1 ? " " : ""}${dial.unit}`;
}

function renderDial(dial: GaugeDial, ox: number): string {
  const cx = ox + DIAL_W / 2;
  const cy = 118;
  const r = 82;
  const start = -SWEEP / 2;
  const end = SWEEP / 2;
  const span = dial.max - dial.min;
  const clamped = Math.min(dial.max, Math.max(dial.min, dial.value));
  const angleOf = (v: number) => start + ((v - dial.min) / span) * SWEEP;
  const parts: string[] = [];
  parts.push(
    `<path d="${arcPath(cx, cy, r, start, end)}" fill="none" stroke="#e7e5ee" stroke-width="14" stroke-linecap="round"/>`,
  );
  if (dial.bands.length > 0) {
    let from = dial.min;
    for (const band of dial.bands) {
      const to = Math.min(dial.max, Math.max(from, band.to));
      if (to > from) {
        parts.push(
          `<path d="${arcPath(cx, cy, r, angleOf(from), angleOf(to))}" fill="none" stroke="${esc(band.color)}" stroke-width="14" stroke-opacity="0.35"/>`,
        );
      }
      from = to;
    }
  }
  const fillColor =
    dial.bands.find((band) => clamped <= band.to)?.color ?? dial.bands.at(-1)?.color ?? ACCENT;
  if (clamped > dial.min) {
    parts.push(
      `<path d="${arcPath(cx, cy, r, start, angleOf(clamped))}" fill="none" stroke="${esc(fillColor)}" stroke-width="14" stroke-linecap="round"/>`,
    );
  }
  for (let i = 0; i <= 8; i++) {
    const a = start + (i / 8) * SWEEP;
    const [x1, y1] = polar(cx, cy, r - 14, a);
    const [x2, y2] = polar(cx, cy, r - (i % 4 === 0 ? 22 : 18), a);
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#b7b3c4" stroke-width="${i % 4 === 0 ? 2 : 1}"/>`,
    );
  }
  const [nx, ny] = polar(cx, cy, r - 26, angleOf(clamped));
  parts.push(
    `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round"/>`,
    `<circle cx="${cx}" cy="${cy}" r="5.5" fill="#1a1a1a"/>`,
    `<circle cx="${cx}" cy="${cy}" r="2" fill="#ffffff"/>`,
  );
  const edge = Math.sin((SWEEP / 2) * (Math.PI / 180)) * r;
  const value = formatValue(dial);
  parts.push(
    `<text x="${(cx - edge - 2).toFixed(1)}" y="${cy + 58}" font-size="11" fill="#6f6b7d" text-anchor="middle">${esc(String(dial.min))}</text>`,
    `<text x="${(cx + edge + 2).toFixed(1)}" y="${cy + 58}" font-size="11" fill="#6f6b7d" text-anchor="middle">${esc(String(dial.max))}</text>`,
    `<text x="${cx}" y="${cy + 42}" font-size="${value.length > 9 ? 19 : 24}" font-weight="700" fill="#1a1a1a" text-anchor="middle">${esc(value)}</text>`,
  );
  if (dial.label) {
    parts.push(
      `<text x="${cx}" y="${cy + 76}" font-size="13" fill="#6f6b7d" text-anchor="middle">${esc(dial.label)}</text>`,
    );
  }
  return parts.join("");
}

/** Render a gauge spec to a standalone SVG string (white card, dark ink). */
export function renderGaugeSvg(spec: PlotSpec, data: unknown[] | undefined): string {
  const dials = gaugeDials(spec, data);
  if (dials.length === 0) throw new Error("A gauge needs a value (number or column name).");
  const perRow = Math.min(dials.length, 4);
  const rowsCount = Math.ceil(dials.length / perRow);
  const titleHeight = spec.title ? 30 : 0;
  const width = perRow * DIAL_W + 16;
  const height = rowsCount * DIAL_H + titleHeight + 8;
  const body = dials
    .map((dial, index) => {
      const col = index % perRow;
      const row = Math.floor(index / perRow);
      const dx = 8 + col * DIAL_W;
      const dy = titleHeight + row * DIAL_H;
      return `<g transform="translate(0 ${dy})">${renderDial(dial, dx)}</g>`;
    })
    .join("");
  const title = spec.title
    ? `<text x="12" y="21" font-size="15" font-weight="600" fill="#1a1a1a">${esc(spec.title)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif" style="background:#ffffff;color:#1a1a1a">${title}${body}</svg>`;
}
