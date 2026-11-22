// Manor: the pinned computer network and the DNS fallback for sandboxed runtimes.
import { getLogger } from "@rakazo/logging";
import type Docker from "dockerode";
import { COMPUTER_DNS } from "./computer-spec.js";
import { runContainerCommand } from "./exec.js";

/**
 * RAKAZO_COMPUTER_NETWORK pins computers to a dedicated network so host egress policy can be
 * applied to that subnet alone. That trades per-bot network isolation for a targetable subnet,
 * so the host firewall becomes what keeps bots off each other's VNC — see the computer network
 * policy section in infra/compose/VPS.md. When it is set, no per-bot network is created.
 */
export function pinnedComputerNetwork(): string | undefined {
  return process.env.RAKAZO_COMPUTER_NETWORK?.trim() || undefined;
}

// Docker keeps its embedded resolver (127.0.0.11) at the front of a container's
// resolv.conf on user-defined networks, and sandboxed runtimes like gVisor
// cannot reach it. Point the computer straight at the configured nameservers.
export async function applyComputerDns(container: Docker.Container) {
  if (!COMPUTER_DNS.length) return;
  const contents = `${COMPUTER_DNS.map((server) => `nameserver ${server}`).join("\n")}\noptions ndots:0\n`;
  try {
    await runContainerCommand(container, [
      "sh",
      "-c",
      `printf %b ${JSON.stringify(contents)} > /etc/resolv.conf`,
    ]);
  } catch (error) {
    getLogger().error("computer dns setup failed", error);
  }
}
