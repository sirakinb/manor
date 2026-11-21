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
  /** Modals: a step lighter than the page so they read as raised above it. */
  dialog: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  /** Fill and hairline where native Liquid Glass is unavailable (Android, iOS before 26). */
  glassFill: string;
  glassStroke: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  chatUser: string;
  /** White in both themes: the user bubble is a solid fill (light grey in dark, near-black in light). */
  chatUserForeground: string;
  muted: string;
  mutedForeground: string;
  /** Tertiary text: placeholders, list markers, quote bars, timestamps. */
  faintForeground: string;
  accent: string;
  accentForeground: string;
  /** Destructive text and outlines. */
  destructive: string;
  /** Solid destructive fill (Hang up, a filled Delete); its text is `destructiveForeground`. */
  destructiveFill: string;
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
  /** Backing behind a link's site icon. White in both themes so dark logos stay visible on any bubble. */
  faviconPlate: string;
  success: string;
  warning: string;
  statusWorking: string;
  /** Unread dot. The one blue in the inbox, in both themes. */
  unread: string;
  /** Working dot on a busy bot's avatar. The one green, in both themes. */
  workingDot: string;
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
  dialog: "#0D0D0D",
  foreground: "#F1F0F3",
  card: "#171717",
  cardForeground: "#F1F0F3",
  popover: "#1A1A1A",
  popoverForeground: "#F1F0F3",
  // Manor: the popover surface and the skin's strong hairline.
  glassFill: "#1A1A1A",
  glassStroke: "#262626",
  primary: "#A855F7",
  primaryForeground: "#FFFFFF",
  secondary: "#1F1F1F",
  secondaryForeground: "#F1F0F3",
  chatUser: "#2B2B2B",
  chatUserForeground: "#F1F0F3",
  muted: "#1F1F1F",
  mutedForeground: "#8A8792",
  // Manor: the skin's second muted step (--rk-muted-2).
  faintForeground: "#6E6975",
  accent: "#242424",
  accentForeground: "#F1F0F3",
  destructive: "#EF4444",
  // Manor: the skin's strong danger (--rk-danger-strong).
  destructiveFill: "#DC2626",
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
  faviconPlate: "#FFFFFF",
  success: "#4ECB71",
  warning: "#E9C46A",
  // Matches Manor's link blue, as the semantic palette requires.
  statusWorking: "#86B7FF",
  // A darker blue than the link: the unread pill sets Manor's near-white text on it (4.7:1),
  // and the unread dot still stands out on the page background (3.7:1).
  unread: "#0066DD",
  // The one green, the same in both themes.
  workingDot: "#3FA266",
  overlay: "rgba(4, 4, 5, 0.72)",
  scrollbar: "#1E2026",
  scrollbarHover: "#2E313A",
} as const satisfies ColorTokens;

export const lightTokens = {
  background: "#FCFCFC",
  dialog: "#FFFFFF",
  foreground: "#000000",
  card: "#EFEFEF",
  cardForeground: "#000000",
  popover: "#FFFFFF",
  popoverForeground: "#000000",
  glassFill: "#FFFFFF",
  glassStroke: "#14141416",
  primary: "#000000",
  primaryForeground: "#FFFFFF",
  secondary: "#7676801F",
  secondaryForeground: "#000000",
  chatUser: "#0B0B0B",
  chatUserForeground: "#FFFFFF",
  muted: "#F2F2F1",
  mutedForeground: "#3C3C43B3",
  faintForeground: "#3C3C4394",
  accent: "#78788029",
  accentForeground: "#000000",
  destructive: "#CE2C31",
  destructiveFill: "#E5484D",
  destructiveForeground: "#FFFFFF",
  border: "#14141414",
  input: "#3C3C434A",
  ring: "#6C6C70",
  sidebar: "#F7F7F7",
  sidebarForeground: "#000000",
  sidebarBorder: "#14141414",
  sidebarAccent: "#FFFFFF",
  sidebarAccentForeground: "#000000",
  link: "#0C64C1",
  faviconPlate: "#FFFFFF",
  success: "#007041",
  warning: "#885A07",
  statusWorking: "#0C64C1",
  unread: "#006CEB",
  workingDot: "#3FA266",
  overlay: "rgba(0, 0, 0, 0.19)",
  scrollbar: "#C8C8C4",
  scrollbarHover: "#A8A8A4",
} as const satisfies ColorTokens;

/** Web and Electron only: the primary fill's hover and disabled states. Mobile has no hover. */
export type WebColorTokens = ColorTokens & {
  primaryHover: string;
  primaryDisabled: string;
};

/**
 * Web and Electron values for the tokens they draw differently from the palettes above. Mobile
 * reads `darkTokens` / `lightTokens`; web reads `tokens.css`, rendered from these merged palettes.
 * Manor's web dark palette is its own dark palette plus the web-only primary states; the light
 * one follows upstream's web design (the web app is pinned to dark).
 */
export const webDarkOverrides = {
  // Manor: web keeps Manor's dark palette and adds only the web-only primary states: the
  // skin's strong accent on hover, and the ink at 13 % when disabled, as upstream's web design does.
  primaryHover: "#9333EA",
  primaryDisabled: "#F1F0F321",
} as const satisfies Partial<WebColorTokens>;

export const webLightOverrides = {
  background: "#FFFFFF",
  foreground: "#1C1C1C",
  card: "#F2F2F2",
  cardForeground: "#1C1C1C",
  popoverForeground: "#1C1C1C",
  primary: "#1C1C1C",
  primaryHover: "#363636",
  primaryDisabled: "#1C1C1C26",
  primaryForeground: "#FCFCFC",
  secondary: "#1C1C1C0F",
  secondaryForeground: "#1C1C1C",
  chatUser: "#1C1C1C",
  muted: "#F2F2F2",
  mutedForeground: "#1C1C1CAD",
  faintForeground: "#1C1C1C8F",
  accent: "#1C1C1C0F",
  accentForeground: "#1C1C1C",
  destructive: "#CD2834",
  destructiveFill: "#E72E3B",
  border: "#1C1C1C1F",
  input: "#1C1C1C3D",
  ring: "#1E86FC",
  sidebar: "#F5F5F5",
  sidebarForeground: "#1C1C1C",
  sidebarBorder: "#1C1C1C1F",
  sidebarAccent: "#1C1C1C14",
  sidebarAccentForeground: "#1C1C1C",
  link: "#0B6DD3",
  success: "#00854A",
  warning: "#AA6300",
  statusWorking: "#0B6DD3",
  unread: "#0B6DD3",
  workingDot: "#10AB61",
  overlay: "#00000080",
  scrollbar: "#1C1C1C3D",
  scrollbarHover: "#1C1C1C85",
} as const satisfies Partial<WebColorTokens>;

export const webDarkTokens: WebColorTokens = { ...darkTokens, ...webDarkOverrides };
export const webLightTokens: WebColorTokens = { ...lightTokens, ...webLightOverrides };

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

export const fontWeight = { regular: "400", medium: "500", semibold: "600" } as const;

/**
 * Native text styles on the system font, in points: iOS body text is 17/22. Titles use the
 * font's own line spacing, written out so they don't inherit a smaller body line height.
 */
export const typeScale = {
  title: { fontSize: 22, lineHeight: 26, fontWeight: fontWeight.semibold },
  headline: { fontSize: 19, lineHeight: 23, fontWeight: fontWeight.semibold },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: fontWeight.medium },
  body: { fontSize: 17, lineHeight: 22 },
  secondary: { fontSize: 15, lineHeight: 19 },
  caption: { fontSize: 14, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 16 },
} as const;

/**
 * Text grows with the iOS text size until body text reaches 23pt, the xxxLarge size. Larger
 * accessibility sizes keep that size, so message bubbles, rows and cards keep their layout.
 */
export const MAX_FONT_SCALE = 23 / typeScale.body.fontSize;

/** The ink of a drawn bot's eyes, the same on every body colour and in both themes. */
export const botEyeColor = "#101014";

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

/** The web and Electron palette; `tokensForAppearance` is the mobile one. */
export function webTokensForAppearance(appearance: ResolvedAppearance): WebColorTokens {
  return appearance === "light" ? webLightTokens : webDarkTokens;
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
export function cssVariableName(token: keyof WebColorTokens): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function renderBlock(selector: string, colorScheme: ResolvedAppearance, palette: WebColorTokens) {
  const lines = (Object.keys(palette) as (keyof WebColorTokens)[]).map(
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

/** The CSS in `tokens.css` (web and Electron). Generated from the web palettes so both stay in sync. */
export function renderTokensCss(): string {
  return `${[
    "/* Generated by `pnpm --filter @rakazo/ui-tokens generate`. Edit src/index.ts instead. */",
    renderBlock(':root,\n[data-theme="dark"]', "dark", webDarkTokens),
    renderBlock('[data-theme="light"]', "light", webLightTokens),
    renderSkinBlock(),
  ].join("\n\n")}\n`;
}
