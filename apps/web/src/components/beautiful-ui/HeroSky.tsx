import { useEffect, useRef, useState } from "react";

/* Hero sky — a living layer over the landing's painted night: slow violet
   mist (three octaves of value noise, two drifting wavefronts) and a field of
   twinkling stars, drawn additively so the illustration underneath stays the
   picture. Raw WebGL fullscreen quad, one fragment shader, no Three.js.
   Motion language borrowed from ThreeUI's stream-convergence / nebula (MIT). */

const VERTEX = `
attribute vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_t;
uniform float u_mist;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0; float amp = 0.5;
  for (int i = 0; i < 4; i++) { v += amp * noise(p); p = p * 2.03 + vec2(17.0, 9.0); amp *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0);
  float t = u_t * 0.045;

  /* violet mist, two slow wavefronts crossing */
  float m1 = fbm(p * 1.6 + vec2(t * 0.9, -t * 0.35));
  float m2 = fbm(p * 2.4 - vec2(t * 0.5, t * 0.7) + 3.1);
  float band = 0.5 + 0.5 * sin((uv.x * 1.7 - uv.y * 0.6) * 6.2831 + u_t * 0.09);
  float mist = smoothstep(0.28, 0.78, m1 * 0.66 + m2 * 0.55 * band);
  /* keep the mist low and to the right, where the painting glows */
  float region = (0.35 + 0.65 * smoothstep(0.0, 0.7, uv.x)) * (1.0 - smoothstep(0.5, 1.0, uv.y) * 0.85);
  vec3 violet = vec3(0.62, 0.32, 0.93);
  vec3 lilac = vec3(0.88, 0.72, 1.0);
  vec3 color = mix(violet, lilac, mist) * mist * region * u_mist;

  /* stars: sparse hash grid, twinkle per cell */
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 60.0;
  vec2 cell = floor(g);
  float h = hash(cell);
  vec2 center = cell + 0.5 + (vec2(hash(cell + 1.3), hash(cell + 7.9)) - 0.5) * 0.7;
  float d = length(g - center);
  float sky = 1.0 - smoothstep(0.35, 0.8, uv.y) * 0.0; /* all heights */
  float twinkle = 0.55 + 0.45 * sin(u_t * (0.8 + h * 1.6) + h * 40.0);
  float star = (h > 0.955 ? 1.0 : 0.0) * smoothstep(0.13, 0.0, d) * twinkle;
  color += vec3(0.95, 0.92, 1.0) * star * (0.55 + 0.45 * uv.y) * sky;

  gl_FragColor = vec4(color, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("hero sky shader", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Additive animated layer for the landing hero. Renders nothing (and costs
 * nothing) when WebGL is unavailable or the viewer prefers reduced motion,
 * so the painted sky underneath is always the fallback.
 */
export function HeroSky({ mist = 0.85, className }: { mist?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    });
    if (!gl) return;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (program) gl.deleteProgram(program);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("hero sky link", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API method, not a React hook
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "u_res");
    const uT = gl.getUniformLocation(program, "u_t");
    const uMist = gl.getUniformLocation(program, "u_mist");
    gl.uniform1f(uMist, mist);

    let frame = 0;
    let painted = false;
    let visible = true;
    let last = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uRes, width, height);
    };
    const started = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || now - last < 1000 / 30) return;
      last = now;
      resize();
      gl.uniform1f(uT, (now - started) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!painted && !gl.isContextLost()) {
        painted = true;
        setReady(true);
      }
    };
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
          })
        : null;
    observer?.observe(canvas);
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
    };
    const onContextLost = () => {
      cancelAnimationFrame(frame);
      setReady(false);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      // StrictMode reuses this canvas on its next setup; keep its context alive.
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [mist]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ visibility: ready ? "visible" : "hidden" }}
    />
  );
}
