export const COMPUTER_IMAGE = process.env.RAKAZO_COMPUTER_IMAGE ?? "rakazo/computer:local";
export const TEAM_SCREEN_LIMIT = 8;
const SCREEN_HOST = process.env.SANDBOX_SCREEN_HOST ?? "127.0.0.1";

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Per-computer resource ceilings. Defaults suit a 2 vCPU / 8 GB host running
// one or two computers alongside the app containers.
const COMPUTER_MEMORY_MB = positiveNumber(process.env.RAKAZO_COMPUTER_MEMORY_MB, 2048);
const COMPUTER_CPUS = positiveNumber(process.env.RAKAZO_COMPUTER_CPUS, 1.5);
const COMPUTER_PIDS = positiveNumber(process.env.RAKAZO_COMPUTER_PIDS, 512);
// Optional OCI runtime for agent computers. Set to "runsc" (gVisor) to run each
// computer on a user-space kernel so a container escape cannot reach the host.
// Unset uses the Docker default runtime.
const COMPUTER_RUNTIME = process.env.RAKAZO_COMPUTER_RUNTIME?.trim() || undefined;
// Sandboxed runtimes such as gVisor virtualize the network stack and cannot
// reach Docker's embedded resolver at 127.0.0.11, so computers need explicit
// nameservers. Container-name lookups are not needed: computers are reached by
// the screen proxy, never the other way around.
export const COMPUTER_DNS = (
  process.env.RAKAZO_COMPUTER_DNS ?? (COMPUTER_RUNTIME ? "1.1.1.1,8.8.8.8" : "")
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

export function screenPorts(index: number) {
  if (index < 0 || index >= TEAM_SCREEN_LIMIT) {
    throw new Error(
      `screen index ${index} exceeds the Team Computer limit of ${TEAM_SCREEN_LIMIT}`,
    );
  }
  return {
    display: `:${index + 1}`,
    displayNumber: index + 1,
    viewPort: String(6080 + index * 2),
    controlPort: String(6081 + index * 2),
    viewVncPort: 5900 + index * 2,
    controlVncPort: 5901 + index * 2,
  };
}

export function computerPortBindings() {
  const ExposedPorts: Record<string, object> = {};
  const PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {};
  for (let index = 0; index < TEAM_SCREEN_LIMIT; index += 1) {
    const ports = screenPorts(index);
    ExposedPorts[`${ports.viewPort}/tcp`] = {};
    ExposedPorts[`${ports.controlPort}/tcp`] = {};
    PortBindings[`${ports.viewPort}/tcp`] = [{ HostIp: "127.0.0.1", HostPort: "0" }];
    PortBindings[`${ports.controlPort}/tcp`] = [{ HostIp: "127.0.0.1", HostPort: "0" }];
  }
  return { ExposedPorts, PortBindings };
}

export interface ComputerCreateInput {
  name: string;
  image: string;
  botId: string;
  workspaceId: string;
  homePath: string;
  networkMode?: string;
}

interface PointerInput {
  kind: "pointer";
  x: number;
  y: number;
  button?: "left" | "right";
  type: "move" | "down" | "up" | "click";
}

export type SandboxInput =
  | { kind: "key"; key: string; modifiers?: string[] }
  | PointerInput
  | { kind: "clipboard"; text: string };

export function containerCreateOptions(input: ComputerCreateInput) {
  const ports = computerPortBindings();
  return {
    Image: input.image,
    name: input.name,
    Tty: true,
    Env: [
      "DISPLAY=:1",
      "HOME=/home/rakazo",
      "PATH=/home/rakazo/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "NPM_CONFIG_PREFIX=/home/rakazo/.local",
      "PIP_USER=1",
    ],
    Labels: {
      "rakazo.managed": "true",
      "rakazo.botId": input.botId,
      "rakazo.workspaceId": input.workspaceId,
    },
    ExposedPorts: ports.ExposedPorts,
    HostConfig: {
      Binds: [`${input.homePath}:/home/rakazo`],
      PortBindings: ports.PortBindings,
      ShmSize: 256 * 1024 * 1024,
      // Keep one computer from starving the host (and every other bot on it).
      // Override per deployment with RAKAZO_COMPUTER_MEMORY_MB / _CPUS / _PIDS.
      Memory: COMPUTER_MEMORY_MB * 1024 * 1024,
      MemorySwap: COMPUTER_MEMORY_MB * 1024 * 1024,
      NanoCpus: Math.round(COMPUTER_CPUS * 1e9),
      PidsLimit: COMPUTER_PIDS,
      ReadonlyPaths: ["/usr/share/novnc"],
      AutoRemove: false,
      NetworkMode: input.networkMode ?? "bridge",
      ...(COMPUTER_RUNTIME ? { Runtime: COMPUTER_RUNTIME } : {}),
      ...(COMPUTER_DNS.length ? { Dns: COMPUTER_DNS } : {}),
    },
    WorkingDir: "/home/rakazo",
  };
}

export function containerNameFor(botId: string) {
  const safe = botId.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40);
  return `rakazo-bot-${safe || "box"}`;
}

export function screenUrlFor(hostPort: string, host = SCREEN_HOST) {
  return `http://${host}:${hostPort}/embed.html`;
}

export function xdotoolCommand(input: SandboxInput): string[] {
  if (input.kind === "key") {
    const key = mapKey(input.key);
    const mods = (input.modifiers ?? []).map(mapKey);
    const combo = [...mods, key].join("+");
    return ["xdotool", "key", "--clearmodifiers", combo];
  }
  if (input.kind === "pointer") {
    const btn = input.button === "right" ? "3" : "1";
    if (input.type === "move")
      return ["xdotool", "mousemove", "--", String(input.x), String(input.y)];
    if (input.type === "down") {
      return ["xdotool", "mousemove", "--", String(input.x), String(input.y), "mousedown", btn];
    }
    if (input.type === "up") return ["xdotool", "mouseup", btn];
    return ["xdotool", "mousemove", "--", String(input.x), String(input.y), "click", btn];
  }
  return ["xdotool", "type", "--clearmodifiers", "--", input.text];
}

function mapKey(key: string) {
  const lower = key.toLowerCase();
  if (lower === "enter" || lower === "return") return "Return";
  if (lower === "esc" || lower === "escape") return "Escape";
  if (lower === "space") return "space";
  if (lower === "tab") return "Tab";
  if (lower === "backspace") return "BackSpace";
  if (lower === "ctrl" || lower === "control") return "ctrl";
  if (lower === "alt") return "alt";
  if (lower === "shift") return "shift";
  if (lower === "meta" || lower === "cmd" || lower === "super") return "super";
  return key;
}
