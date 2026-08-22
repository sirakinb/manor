/**
 * The CRM wears Manor's palette: violet stepped through lightness for stage
 * progression, and the classic won/lost pair for money. All chosen against
 * the app's near-black ground.
 */

const STAGE_SCALE = ["#6D28D9", "#7C3AED", "#8B5CF6", "#A855F7", "#C084FC", "#D8B4FE"];

export function stageColor(position: number): string {
  return STAGE_SCALE[Math.min(position, STAGE_SCALE.length - 1)] ?? STAGE_SCALE[0]!;
}

export const STATUS_COLORS = {
  open: "#A855F7",
  won: "#4ADE80",
  lost: "#F87171",
} as const;

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Compact form for chart labels: $1.2M, $45k. */
export function formatMoneyShort(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
