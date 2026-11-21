import { tokens, tokensForAppearance } from "@rakazo/ui-tokens";
import { useMemo, useSyncExternalStore } from "react";
import { type ColorValue, Platform, PlatformColor } from "react-native";
import {
  getCachedAppearancePreference,
  mobileTokens,
  type ResolvedAppearance,
  resolveMobileAppearance,
  subscribeAppearance,
} from "./appearance";

function systemColor(iosName: string, fallback: string): ColorValue {
  // PlatformColor follows the OS scheme, not an explicit app Light/Dark choice.
  if (Platform.OS === "ios" && getCachedAppearancePreference() === "system") {
    return PlatformColor(iosName);
  }
  return fallback;
}

/** Theme-aware native colors backed by shared tokens (+ iOS platform colors in System). */
export const native = {
  get page() {
    return mobileTokens().background;
  },
  get fill() {
    return systemColor("tertiarySystemFill", mobileTokens().muted);
  },
  get fillPressed() {
    return systemColor("secondarySystemFill", mobileTokens().accent);
  },
  get label() {
    return systemColor("label", mobileTokens().foreground);
  },
  get secondaryLabel() {
    return systemColor("secondaryLabel", mobileTokens().mutedForeground);
  },
  get tertiaryLabel() {
    return systemColor("tertiaryLabel", mobileTokens().mutedForeground);
  },
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

function appearanceSnapshot(): string {
  return `${getCachedAppearancePreference()}:${resolveMobileAppearance()}`;
}

export function useResolvedAppearance(): ResolvedAppearance {
  // Include the preference: System -> Light must replace iOS PlatformColor
  // objects even when both currently resolve to light.
  useSyncExternalStore(subscribeAppearance, appearanceSnapshot, () => "system:dark");
  return resolveMobileAppearance();
}

/** Rebuild styles for palette changes and switches to/from iOS system colors. */
export function useThemedStyles<T>(factory: () => T): T {
  const resolved = useResolvedAppearance();
  const preference = getCachedAppearancePreference();
  return useMemo(factory, [resolved, preference]);
}

/** Subscribe custom surfaces to the same appearance as native navigation. */
export function useMobileTokens() {
  return tokensForAppearance(useResolvedAppearance());
}
