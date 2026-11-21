import { useEffect, useRef } from "react";

/* Manor orb — hand-ported from ThreeUI "Brand Orbs" (github.com/MengTo/threeui,
   MIT © Meng To / DesignCode). Keeps the reference engine's z-sorted dot
   painter, orthographic projector and "blossom knot" sphere, re-tinted to the
   Manor purple and exposed as a plain canvas element (no iframe, no Three.js). */

const TAU = Math.PI * 2;
const ACCENT: [number, number, number] = [168, 85, 247];
const FRAME_MS = 1000 / 30;

type Dot = { x: number; y: number; z: number; r: number; v: number; a?: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rscale = (size: number) => (size / 300) ** 0.6;

function proj(yaw: number, tilt: number, cx: number, cy: number, s: number) {
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  const sy = Math.sin(yaw);
  const cyw = Math.cos(yaw);
  return (x: number, y: number, z: number): [number, number, number] => {
    const px = x * cyw + z * sy;
    const pz = -x * sy + z * cyw;
    const py = y * ct - pz * st;
    const z2 = y * st + pz * ct;
    return [cx + px * s, cy - py * s, z2];
  };
}

function paint(ctx: CanvasRenderingContext2D, dots: Dot[], sat: number, rMin: number) {
  dots.sort((a, b) => a.z - b.z);
  for (const d of dots) {
    const al = d.a ?? 1;
    if (al < 0.02) continue;
    const v = clamp01(d.v);
    const g = v * 255;
    const lift = Math.min(1, v * 1.12);
    let r = g * (1 - sat) + ACCENT[0] * lift * sat;
    let gg = g * (1 - sat) + ACCENT[1] * lift * sat;
    let b = g * (1 - sat) + ACCENT[2] * lift * sat;
    if (v > 0.85) {
      const w = ((v - 0.85) / 0.15) * 0.45;
      r += (255 - r) * w;
      gg += (255 - gg) * w;
      b += (255 - b) * w;
    }
    ctx.fillStyle = `rgba(${r | 0},${gg | 0},${b | 0},${al})`;
    ctx.beginPath();
    ctx.arc(d.x, d.y, Math.max(rMin, d.r), 0, TAU);
    ctx.fill();
  }
}

/** Six tilted rings in 6-fold symmetry with bright runners chasing around them. */
function drawKnot(ctx: CanvasRenderingContext2D, size: number, t: number, mini: boolean) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) * 0.8;
  const rs = rscale(size) * (mini ? 2.3 : 1.15);
  const p = proj(t * 0.26, 0.35 + 0.08 * Math.sin(t * 0.4), cx, cy, radius);
  const rings = 6;
  const phi = 1.13;
  const ghostN = mini ? 14 : 32;
  const runners = 2;
  const dots: Dot[] = [];
  // Soft halo so the mark reads as one glowing body even at 20px.
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius * 1.15);
  halo.addColorStop(0, "rgba(168,85,247,0.30)");
  halo.addColorStop(0.7, "rgba(168,85,247,0.10)");
  halo.addColorStop(1, "rgba(168,85,247,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.15, 0, TAU);
  ctx.fill();
  for (let i = 0; i < rings; i++) {
    const a = (i / rings) * TAU;
    const nx = Math.sin(phi) * Math.cos(a);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(a);
    let ux = -nz;
    const uy = 0;
    let uz = nx;
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul;
    uz /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const rad = 0.74;
    for (let j = 0; j < ghostN; j++) {
      const th = (j / ghostN) * TAU;
      const [x, y, z] = p(
        (ux * Math.cos(th) + vx * Math.sin(th)) * rad,
        (uy * Math.cos(th) + vy * Math.sin(th)) * rad,
        (uz * Math.cos(th) + vz * Math.sin(th)) * rad,
      );
      const dep = (z + 1) / 2;
      dots.push({
        x,
        y,
        z,
        r: (0.65 + 1 * dep) * rs,
        v: (mini ? 0.55 : 0.42) + 0.45 * dep,
        a: (mini ? 0.55 : 0.4) + 0.6 * dep,
      });
    }
    for (let m = 0; m < runners; m++) {
      const th = t * (i % 2 ? -0.9 : 0.9) + i * 1.05 + (m / runners) * TAU;
      const [x, y, z] = p(
        (ux * Math.cos(th) + vx * Math.sin(th)) * rad,
        (uy * Math.cos(th) + vy * Math.sin(th)) * rad,
        (uz * Math.cos(th) + vz * Math.sin(th)) * rad,
      );
      const dep = (z + 1) / 2;
      dots.push({ x, y, z, r: (1.2 + 1.5 * dep) * rs, v: 0.82 + 0.18 * dep });
    }
  }
  paint(ctx, dots, 0.78, mini ? 0.5 : 0.3);
}

/**
 * A living Manor mark for "the bot is working" states. Renders on a 2D canvas
 * at device resolution, animates at 30 fps only while on screen, and holds a
 * single frame when the viewer prefers reduced motion.
 */
export function ManorOrb({
  size = 28,
  speed = 1,
  paused = false,
  className,
  label,
}: {
  size?: number;
  speed?: number;
  paused?: boolean;
  className?: string;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const mini = size <= 24;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let visible = true;
    let frame = 0;
    let last = 0;
    const started = performance.now();
    const render = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawKnot(ctx, size, ((now - started) / 1000) * speed, mini);
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || paused) return;
      if (now - last < FRAME_MS) return;
      last = now;
      render(now);
    };
    render(started);
    if (reduceMotion) return;
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
          })
        : null;
    observer?.observe(canvas);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [size, speed, paused]);

  return (
    <canvas
      ref={canvasRef}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
