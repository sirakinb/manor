import { BotAvatar } from "@rakazo/ui-web";

/**
 * A room's members, stacked. Rooms and single bots share one list, so the
 * stack is what tells them apart at a glance.
 */
export function RoomAvatars({
  colors,
  size = 38,
  max = 3,
}: {
  colors: string[];
  size?: number;
  max?: number;
}) {
  const shown = colors.slice(0, max);
  if (shown.length === 0) {
    return (
      <span
        className="inline-block shrink-0 rounded-[30%] bg-[#26262A]"
        style={{ width: size, height: size }}
      />
    );
  }
  // Each face is smaller than the slot so the stack still occupies one row.
  const face = Math.round(size * 0.74);
  const step = Math.round(face * 0.42);
  const width = face + step * (shown.length - 1);

  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {shown.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="absolute"
          style={{
            left: `${(size - width) / 2 + index * step}px`,
            top: `${(size - face) / 2 + (index % 2 === 0 ? -2 : 2)}px`,
            zIndex: shown.length - index,
          }}
        >
          <BotAvatar color={color} size={face} />
        </span>
      ))}
    </span>
  );
}
