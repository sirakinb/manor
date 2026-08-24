import { tokens } from "@rakazo/ui-tokens";
import { type ColorValue, Platform, PlatformColor } from "react-native";

function systemColor(iosName: string, fallback: string): ColorValue {
  return Platform.OS === "ios" ? PlatformColor(iosName) : fallback;
}

export const native = {
  page: tokens.page,
  fill: systemColor("tertiarySystemFill", "#1C1C1E"),
  fillPressed: systemColor("secondarySystemFill", "#2C2C2E"),
  label: systemColor("label", "#FFFFFF"),
  secondaryLabel: systemColor("secondaryLabel", "#8E8E93"),
  tertiaryLabel: systemColor("tertiaryLabel", "#6C6C70"),
} as const;

/**
 * Manor's own palette. `native` above defers to iOS system colors so lists feel
 * native; these are the fixed brand values for surfaces the brand owns.
 */
export const manor = {
  page: tokens.page,
  main: tokens.main,
  surface: tokens.surface,
  surface2: tokens.surface2,
  hairline: tokens.hairline,
  hairlineStrong: tokens.hairlineStrong,
  ink: tokens.ink,
  body: tokens.body,
  muted: tokens.muted,
  muted2: tokens.muted2,
  accent: tokens.accent,
  danger: tokens.danger,
} as const;

/**
 * Mirrors the .rk-wordmark and .rk-label treatments in apps/web/src/styles.css.
 * The web falls back to Georgia and the system monospace, so naming those here
 * keeps both platforms on the same faces without bundling font files.
 */
export const brandType = {
  wordmark: Platform.select({ ios: "Georgia", default: "serif" }),
  label: Platform.select({ ios: "Menlo", default: "monospace" }),
} as const;
