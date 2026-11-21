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
