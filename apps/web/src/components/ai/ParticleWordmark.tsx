import { useEffect, useRef } from "react";

/* Particle wordmark — the MANOR lockup assembled from drifting dots.
   Inspired by ThreeUI's particle wordmark / semantic bloom (MIT,
   github.com/MengTo/threeui); engine written for Manor: text is rasterised
   once to an offscreen canvas, its pixels become particle targets, and each
   particle springs home from a scattered start, then breathes in place and
   parts around the pointer. Plain Canvas 2D, no Three.js. */

export type WordmarkTarget = { x: number; y: number };

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  r: number;
  accent: boolean;
  phase: number;
  delay: number;
};

const ACCENT = "168,85,247";
const INK = "236,232,246";

/** Rasterise `text` and return one target per lit sample cell (CSS px). */
export function sampleWordmark(
  text: string,
  font: string,
  width: number,
  height: number,
  letterSpacingEm: number,
  gap: number,
): WordmarkTarget[] {
  if (typeof document === "undefined") return [];
  const scratch = document.createElement("canvas");
  scratch.width = Math.max(1, Math.round(width));
  scratch.height = Math.max(1, Math.round(height));
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? "48");
  const tracking = size * letterSpacingEm;
  const chars = Array.from(text);
  const widths = chars.map((char) => ctx.measureText(char).width);
  const total = widths.reduce((sum, w) => sum + w, 0) + tracking * (chars.length - 1);
  let x = (width - total) / 2;
  const y = height / 2;
  chars.forEach((char, index) => {
    ctx.fillText(char, x, y);
    x += (widths[index] ?? 0) + tracking;
  });
  const data = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
  const targets: WordmarkTarget[] = [];
  for (let py = 0; py < scratch.height; py += gap) {
    for (let px = 0; px < scratch.width; px += gap) {
      if ((data[(py * scratch.width + px) * 4 + 3] ?? 0) > 110) targets.push({ x: px, y: py });
    }
  }
  return targets;
}

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeParticles(
  targets: WordmarkTarget[],
  width: number,
  height: number,
  seed = 7,
): Particle[] {
  const rand = seeded(seed);
  const cx = width / 2;
  const cy = height / 2;
  return targets.map((target) => {
    const angle = rand() * Math.PI * 2;
    const radius = Math.max(width, height) * (0.55 + rand() * 0.5);
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      tx: target.x,
      ty: target.y,
      r: 0.7 + rand() * 0.75,
      accent: rand() < 0.22,
      phase: rand() * Math.PI * 2,
      delay: rand() * 0.55,
    };
  });
}

/** One physics step. `t` in seconds since start; pointer in CSS px or null. */
export function stepParticles(
  particles: Particle[],
  t: number,
  pointer: { x: number; y: number } | null,
  dt: number,
) {
  const k = 0.085;
  const damping = 0.8;
  const clampDt = Math.min(dt, 1 / 20) * 60;
  for (const p of particles) {
    if (t < p.delay) continue;
    const breathe = 1.4 * Math.sin(t * 1.1 + p.phase);
    let tx = p.tx + breathe * Math.cos(p.phase);
    let ty = p.ty + breathe * Math.sin(p.phase);
    if (pointer) {
      const dx = tx - pointer.x;
      const dy = ty - pointer.y;
      const d2 = dx * dx + dy * dy;
      const radius = 70;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2) || 1;
        const push = (1 - d / radius) * 26;
        tx += (dx / d) * push;
        ty += (dy / d) * push;
      }
    }
    p.vx = (p.vx + (tx - p.x) * k) * damping;
    p.vy = (p.vy + (ty - p.y) * k) * damping;
    p.x += p.vx * clampDt;
    p.y += p.vy * clampDt;
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], t: number) {
  for (const p of particles) {
    if (t < p.delay) continue;
    const settled = Math.min(1, Math.max(0, (t - p.delay) / 1.4));
    const alpha = 0.35 + 0.65 * settled;
    ctx.fillStyle = `rgba(${p.accent ? ACCENT : INK},${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A wordmark made of particles. Sized by its container width; `fontSize` is
 * the cap height in CSS px. Holds the assembled state under reduced motion.
 */
export function ParticleWordmark({
  text,
  fontSize = 96,
  fontWeight = 600,
  letterSpacingEm = 0.32,
  gap = 3,
  className,
  label,
  fitOnMobile = false,
}: {
  text: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacingEm?: number;
  gap?: number;
  className?: string;
  label?: string;
  fitOnMobile?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const font = `${fontWeight} ${fontSize}px Fraunces, Georgia, serif`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let pointer: { x: number; y: number } | null = null;
    let started = performance.now();
    let last = started;
    let disposed = false;

    const layout = () => {
      const parent = canvas.parentElement;
      width = Math.max(1, Math.round(parent?.clientWidth ?? canvas.clientWidth ?? 320));
      let fittedFont = font;
      if (fitOnMobile && window.matchMedia("(max-width: 639px)").matches) {
        ctx.font = font;
        const chars = Array.from(text);
        const textWidth =
          chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0) +
          fontSize * letterSpacingEm * Math.max(0, chars.length - 1);
        const scale = Math.min(1, Math.max(1, width - 48) / Math.max(1, textWidth));
        fittedFont = `${fontWeight} ${fontSize * scale}px Fraunces, Georgia, serif`;
      }
      height = Math.round(fontSize * 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.height = `${height}px`;
      const targets = sampleWordmark(text, fittedFont, width, height, letterSpacingEm, gap);
      particles = makeParticles(targets, width, height);
      started = performance.now();
      last = started;
      if (reduceMotion) {
        for (const p of particles) {
          p.x = p.tx;
          p.y = p.ty;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        drawParticles(ctx, particles, 10);
      }
    };

    const loop = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(loop);
      if (!visible) return;
      const t = (now - started) / 1000;
      const dt = (now - last) / 1000;
      last = now;
      stepParticles(particles, t, pointer, dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawParticles(ctx, particles, t);
    };

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onLeave = () => {
      pointer = null;
    };

    const ready = document.fonts?.load(font).catch(() => undefined) ?? Promise.resolve();
    void ready.then(() => {
      if (disposed) return;
      layout();
      if (reduceMotion) return;
      frame = requestAnimationFrame(loop);
    });

    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => layout()) : null;
    if (canvas.parentElement) resize?.observe(canvas.parentElement);
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
          })
        : null;
    observer?.observe(canvas);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      observer?.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [text, fontSize, fontWeight, letterSpacingEm, gap, fitOnMobile]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label ?? text}
      className={className}
      style={{ display: "block", width: "100%" }}
    />
  );
}
