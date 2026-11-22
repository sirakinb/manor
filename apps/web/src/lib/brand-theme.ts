/**
 * Translates a client brand's palette into the semantic variables the shared UI reads.
 * Only the accent family is mapped: brands have never tinted the shell's surfaces, so
 * those keep the neutral values from @rakazo/ui-tokens.
 */

const WHITE = "#ffffff";
const INK = "#1a1a1a";

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` color, or undefined when it is not one. */
export function relativeLuminance(hex: string): number | undefined {
  const color = hex.trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  return 0.2126 * channel(color, 1) + 0.7152 * channel(color, 3) + 0.0722 * channel(color, 5);
}

/** White text unless it falls under 3:1 on the accent, as it does on a yellow one. */
export function readableOn(accent: string): string {
  const luminance = relativeLuminance(accent);
  if (luminance === undefined) return WHITE;
  return 1.05 / (luminance + 0.05) >= 3 ? WHITE : INK;
}

/** Custom properties to set on the root for a brand; empty for the default brand. */
export function brandThemeVariables(colors: Readonly<Record<string, string>>) {
  const variables: Record<string, string> = {};
  for (const [token, color] of Object.entries(colors)) variables[`--rk-${token}`] = color;
  const accent = colors.accent;
  if (accent) {
    variables["--bui-accent"] = accent;
    variables["--primary"] = accent;
    variables["--primary-foreground"] = readableOn(accent);
    variables["--ring"] = accent;
  }
  return variables;
}
