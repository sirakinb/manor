import { parseBotAvatarValue } from "./bot-avatar.js";

/**
 * Manor: the stored plain colours a bot is drawn as one of Manor's sprites on, when it has no
 * uploaded image and no chosen shape. Upstream's brighter Executive Violet (`#A97EFE`, the
 * default colour) draws the same purple sprite as the earlier `#8B5CF6`.
 */
export const MANOR_SPRITE_COLORS = [
  "#8B5CF6",
  "#A97EFE",
  "#F5C542",
  "#3FB6AE",
  "#A78BFA",
  "#F08040",
  "#E0524D",
  "#5B8DEF",
] as const;

/** True when a stored `bots.color` value draws Manor's sprite: a plain sprite colour only. */
export function drawsManorSprite(storedColor: string): boolean {
  const parsed = parseBotAvatarValue(storedColor);
  return (
    parsed.kind === "color" &&
    (MANOR_SPRITE_COLORS as readonly string[]).includes(parsed.color.toUpperCase())
  );
}
