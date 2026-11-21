import { tokens, tokensForAppearance } from "@rakazo/ui-tokens";
import { useMemo, useSyncExternalStore } from "react";
import type { ColorValue } from "react-native";
import { Platform, PlatformColor } from "react-native";
import type { ResolvedAppearance } from "./appearance";
import {
  getCachedAppearancePreference,
  mobileTokens,
  resolveMobileAppearance,
  subscribeAppearance,
} from "./appearance";
import { translucentColor } from "./color";

function systemColor(iosName: string, fallback: string): ColorValue {
  // PlatformColor follows the OS scheme, not an explicit app Light/Dark choice.
  if (Platform.OS === "ios" && getCachedAppearancePreference() === "system") {
    return PlatformColor(iosName);
  }
  return fallback;
}

/** Apple's systemGreen for the resolved app appearance. */
export function systemGreen(scheme: ResolvedAppearance): string {
  return scheme === "dark" ? "#30D158" : "#34C759";
}

/** Theme-aware native colors backed by shared tokens (+ iOS platform colors in System). */
export const native = {
  get page() {
    return mobileTokens().background;
  },
  get fill() {
    return systemColor("tertiarySystemFill", mobileTokens().muted);
  },
  /** The lightest fill, for small chips. */
  get quietFill() {
    return systemColor("quaternarySystemFill", mobileTokens().muted);
  },
  get fillPressed() {
    return systemColor("secondarySystemFill", mobileTokens().accent);
  },
  get separator() {
    // Rows are divided by the palette's divider in every mode, not the iOS separator.
    return mobileTokens().border;
  },
  get label() {
    return systemColor("label", mobileTokens().foreground);
  },
  get secondaryLabel() {
    if (resolveMobileAppearance() === "light") return mobileTokens().mutedForeground;
    return systemColor("secondaryLabel", mobileTokens().mutedForeground);
  },
  get tertiaryLabel() {
    return mobileTokens().faintForeground;
  },
  /** iOS's own tertiary label, which follows Increase Contrast; else the label grey at 30%. */
  get systemTertiaryLabel() {
    return systemColor("tertiaryLabel", translucentColor(mobileTokens().mutedForeground, 0.3));
  },
  // Grouped colours always come from the tokens: settings sit on the page colour with
  // grey cells in both themes, and in dark iOS lifts the system ones inside sheets and with
  // Increase Contrast until destructive text drops below 4.5:1.
  get groupedPage() {
    return mobileTokens().background;
  },
  get groupedCell() {
    return mobileTokens().card;
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
