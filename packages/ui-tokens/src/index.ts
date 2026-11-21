export const APPEARANCE_PREFERENCES = ["system", "light", "dark"] as const;

export type AppearancePreference = (typeof APPEARANCE_PREFERENCES)[number];

export type ResolvedAppearance = "light" | "dark";

export const UI_APPEARANCE_STORAGE_KEY = "rakazo.uiAppearance";

/**
 * Semantic palette shared by web, Electron, and Expo. Names follow the shadcn
 * convention so the same slot means the same thing on every surface: a `border`
 * is always a border and never a fill.
 */
export type ColorTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  chatUser: string;
  chatUserForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  link: string;
  success: string;
  warning: string;
  overlay: string;
  scrollbar: string;
  scrollbarHover: string;
};

/**
 * Manor's dark palette: neutral jet black surfaces with the purple primary.
 * The values are the hex forms of the HSL base variables Manor shipped before
 * the palette became semantic.
 */
export const darkTokens = {
  background: "#0A0A0A",
  foreground: "#F1F0F3",
  card: "#171717",
  cardForeground: "#F1F0F3",
  popover: "#1A1A1A",
  popoverForeground: "#F1F0F3",
  primary: "#A855F7",
  primaryForeground: "#FFFFFF",
  secondary: "#1F1F1F",
  secondaryForeground: "#F1F0F3",
  chatUser: "#2B2B2B",
  chatUserForeground: "#F1F0F3",
  muted: "#1F1F1F",
  mutedForeground: "#8A8792",
  accent: "#242424",
  accentForeground: "#F1F0F3",
  destructive: "#EF4444",
  destructiveForeground: "#FFFFFF",
  border: "#1F1F1F",
  input: "#242424",
  ring: "#8F47D1",
  // One step off the background, as the semantic palette requires. Manor's own shell
  // paints its sidebar with --rk-sidebar, which stays the page black.
  sidebar: "#111111",
  sidebarForeground: "#F1F0F3",
  sidebarBorder: "#1F1F1F",
  sidebarAccent: "#232323",
  sidebarAccentForeground: "#F1F0F3",
  link: "#86B7FF",
  success: "#4ECB71",
  warning: "#E9C46A",
  overlay: "rgba(4, 4, 5, 0.62)",
  scrollbar: "#2A2A2E",
  scrollbarHover: "#414147",
} as const satisfies ColorTokens;

export const lightTokens = {
  background: "#FAFAF8",
  foreground: "#1A1A1A",
  card: "#FFFFFF",
  cardForeground: "#1A1A1A",
  popover: "#FFFFFF",
  popoverForeground: "#1A1A1A",
  primary: "#1A1A1A",
  primaryForeground: "#F1F1EF",
  secondary: "#F0F0ED",
  secondaryForeground: "#1A1A1A",
  chatUser: "#E2E2DC",
  chatUserForeground: "#1A1A1A",
  muted: "#F0F0ED",
  mutedForeground: "#6C6C70",
  accent: "#EAEAE6",
  accentForeground: "#1A1A1A",
  destructive: "#DC2626",
  destructiveForeground: "#FFFFFF",
  border: "#F0F0ED",
  input: "#EAEAE6",
  ring: "#6C6C70",
  sidebar: "#ECECE9",
  sidebarForeground: "#1A1A1A",
  sidebarBorder: "#E8E8E4",
  sidebarAccent: "#FFFFFF",
  sidebarAccentForeground: "#1A1A1A",
  link: "#2563EB",
  success: "#228B3B",
  warning: "#B7791F",
  overlay: "rgba(20, 20, 22, 0.45)",
  scrollbar: "#C8C8C4",
  scrollbarHover: "#A8A8A4",
} as const satisfies ColorTokens;

/**
 * Manor's skin palette, published as the `--rk-*` custom properties that the
 * Manor shell and brand overrides (`@rakazo/brands`) are written against. It is
 * dark only. For theme-aware semantic colors use `tokensForAppearance`.
 */
export const tokens = {
  page: "#0A0A0A",
  sidebar: "#0A0A0A",
  main: "#0A0A0A",
  panel: "#0A0A0A",
  hairline: "#1A1A1A",
  hairlineStrong: "#262626",
  surface: "#161616",
  surface2: "#232323",
  ink: "#F1F0F3",
  body: "#DFDDE3",
  muted: "#8A8590",
  muted2: "#6E6975",
  cream: "#F1F1EF",
  creamInk: "#1A1A1A",
  accent: "#A855F7",
  accentStrong: "#9333EA",
  accentSoft: "#C084FC",
  danger: "#EF4444",
  dangerStrong: "#DC2626",
  dangerSoft: "#FCA5A5",
  success: "#30A24B",
  successSoft: "#4ECB71",
} as const;

export const RADIUS = "0.75rem";

// Manor sprite family: purple, yellow, teal, lavender, orange, red, blue.
// Hexes must match the SPRITES map in ui-web/bot-avatar.tsx.
export const botColors = [
  "#8B5CF6",
  "#F5C542",
  "#3FB6AE",
  "#A78BFA",
  "#F08040",
  "#E0524D",
  "#5B8DEF",
] as const;

export function isAppearancePreference(
  value: string | null | undefined,
): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function normalizeAppearancePreference(
  raw: string | null | undefined,
): AppearancePreference {
  return isAppearancePreference(raw) ? raw : "system";
}

export type ResolveAppearancePreferenceOptions = {
  stored?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
};

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function resolveAppearancePreference(
  options: ResolveAppearancePreferenceOptions = {},
): AppearancePreference {
  const stored =
    options.stored !== undefined
      ? options.stored
      : readStoredAppearance(options.storage ?? getLocalStorage());
  return normalizeAppearancePreference(stored);
}

export function persistAppearancePreference(
  preference: AppearancePreference,
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(UI_APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Ignore quota / private-mode failures; in-memory preference still applies.
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  system: ResolvedAppearance = "dark",
): ResolvedAppearance {
  if (preference === "system") return system;
  return preference;
}

export function tokensForAppearance(appearance: ResolvedAppearance): ColorTokens {
  return appearance === "light" ? lightTokens : darkTokens;
}

function readStoredAppearance(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(UI_APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** `cardForeground` -> `--card-foreground` */
export function cssVariableName(token: keyof ColorTokens): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function renderBlock(selector: string, colorScheme: ResolvedAppearance, palette: ColorTokens) {
  const lines = (Object.keys(palette) as (keyof ColorTokens)[]).map(
    (token) => `  ${cssVariableName(token)}: ${palette[token].toLowerCase()};`,
  );
  return `${selector} {\n  color-scheme: ${colorScheme};\n${lines.join("\n")}\n  --radius: ${RADIUS};\n}`;
}

/** `hairlineStrong` -> `--rk-hairline-strong`, `surface2` -> `--rk-surface-2` */
export function skinVariableName(token: keyof typeof tokens): string {
  const name = token
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([a-z])(\d)/g, "$1-$2")
    .toLowerCase();
  return `--rk-${name}`;
}

function renderSkinBlock() {
  const lines = (Object.keys(tokens) as (keyof typeof tokens)[]).map(
    (token) => `  ${skinVariableName(token)}: ${tokens[token].toLowerCase()};`,
  );
  return `:root {\n${lines.join("\n")}\n  --rk-radius: ${RADIUS};\n}`;
}

/** The CSS in `tokens.css`. Generated from the TS palette so both stay in sync. */
export function renderTokensCss(): string {
  return `${[
    "/* Generated by `pnpm --filter @rakazo/ui-tokens generate`. Edit src/index.ts instead. */",
    renderBlock(':root,\n[data-theme="dark"]', "dark", darkTokens),
    renderBlock('[data-theme="light"]', "light", lightTokens),
    renderSkinBlock(),
  ].join("\n\n")}\n`;
}
