import { DEFAULT_AVATAR_STYLE } from "@rakazo/core";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";

export type AvatarStyle = "robot" | "organic";

const AvatarStyleContext = createContext<AvatarStyle>(DEFAULT_AVATAR_STYLE);

export function AvatarStyleProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AvatarStyle;
}) {
  return <AvatarStyleContext value={value}>{children}</AvatarStyleContext>;
}

export function useAvatarStyle(): AvatarStyle {
  return useContext(AvatarStyleContext);
}
