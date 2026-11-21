import type { AvatarStyle } from "@rakazo/contracts";

/**
 * Manor: the style used when an account has no stored choice or it has not
 * loaded yet. The robot style shows Manor's sprite avatars, so it stays the
 * default for everyone; organic remains available as an explicit choice.
 */
export const DEFAULT_AVATAR_STYLE: AvatarStyle = "robot";
