import { cn } from "./lib/utils.js";

const SPRITES: Record<string, string> = {
  "#8B5CF6": "/sprites/sprite-purple.png",
  "#F5C542": "/sprites/sprite-yellow.png",
  "#3FB6AE": "/sprites/sprite-teal.png",
  "#A78BFA": "/sprites/sprite-lavender.png",
  "#F08040": "/sprites/sprite-orange.png",
  "#E0524D": "/sprites/sprite-red.png",
  "#5B8DEF": "/sprites/sprite-blue.png",
};

export function BotAvatar({
  color,
  size = 38,
  className,
}: {
  color: string;
  size?: number;
  className?: string;
}) {
  const sprite = SPRITES[color.toUpperCase()];
  if (sprite) {
    return (
      <img
        src={sprite}
        alt=""
        className={cn(className)}
        style={{ width: size, height: size, objectFit: "contain", flex: "none" }}
      />
    );
  }
  const visorW = Math.round(size * 0.68);
  const visorH = Math.round(size * 0.4);
  const dot = Math.max(3, Math.round(size * 0.1));
  return (
    <div
      className={cn("flex items-center justify-center rounded-full", className)}
      style={{ width: size, height: size, background: color, flex: "none" }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: visorW,
          height: visorH,
          borderRadius: Math.round(visorH * 0.55),
          background: "rgba(12,12,14,0.78)",
          gap: Math.max(4, Math.round(size * 0.13)),
        }}
      >
        <span className="rounded-full bg-white" style={{ width: dot, height: dot }} />
        <span className="rounded-full bg-white" style={{ width: dot, height: dot }} />
      </div>
    </div>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-full bg-[#16161A]">
        <span className="h-4 w-[7px] rounded-full bg-[#F7F7F4]" />
        <span className="h-4 w-[7px] rounded-full bg-[#F7F7F4]" />
      </div>
      <span className="font-[Aeonik,ui-sans-serif] text-[28px] tracking-tight text-[#1B1B1E]">
        Rakazo
      </span>
    </div>
  );
}
