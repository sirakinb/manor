import { Image, View } from "react-native";
import { manor } from "../lib/native";

// Hexes must match the SPRITES map in packages/ui-web/src/bot-avatar.tsx.
const SPRITES: Record<string, number> = {
  "#8B5CF6": require("../assets/sprites/sprite-purple.png"),
  "#F5C542": require("../assets/sprites/sprite-yellow.png"),
  "#3FB6AE": require("../assets/sprites/sprite-teal.png"),
  "#A78BFA": require("../assets/sprites/sprite-lavender.png"),
  "#F08040": require("../assets/sprites/sprite-orange.png"),
  "#E0524D": require("../assets/sprites/sprite-red.png"),
  "#5B8DEF": require("../assets/sprites/sprite-blue.png"),
};

export function BotAvatar({ color, size = 54 }: { color: string; size?: number }) {
  const sprite = SPRITES[color.toUpperCase()];
  if (sprite) {
    return <Image source={sprite} resizeMode="contain" style={{ width: size, height: size }} />;
  }
  const visorW = Math.round(size * 0.68);
  const visorH = Math.round(size * 0.4);
  const dot = Math.max(3, Math.round(size * 0.1));
  const gap = Math.max(4, Math.round(size * 0.13));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: visorW,
          height: visorH,
          borderRadius: Math.round(visorH * 0.55),
          backgroundColor: "rgba(12,12,14,0.78)",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap,
        }}
      >
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: "#fff" }} />
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: "#fff" }} />
      </View>
    </View>
  );
}

/**
 * A group's members, stacked. Groups and single bots share one list, so the
 * stack is what tells them apart at a glance. Mirrors apps/web/src/pages/GroupAvatars.tsx.
 */
export function GroupAvatar({
  colors,
  size = 54,
  max = 3,
}: {
  colors: string[];
  size?: number;
  max?: number;
}) {
  const shown = colors.slice(0, max);
  if (shown.length === 0) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.3,
          backgroundColor: manor.surface2,
        }}
      />
    );
  }
  // Each face is smaller than the slot so the stack still occupies one row.
  const face = Math.round(size * 0.74);
  const step = Math.round(face * 0.42);
  const width = face + step * (shown.length - 1);

  return (
    <View accessibilityElementsHidden style={{ width: size, height: size }}>
      {shown.map((color, index) => (
        <View
          key={`${color}-${index}`}
          style={{
            position: "absolute",
            left: (size - width) / 2 + index * step,
            top: (size - face) / 2 + (index % 2 === 0 ? -2 : 2),
            zIndex: shown.length - index,
          }}
        >
          <BotAvatar color={color} size={face} />
        </View>
      ))}
    </View>
  );
}
