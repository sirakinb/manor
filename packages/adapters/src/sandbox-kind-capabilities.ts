import type { SandboxKindCapabilities } from "@rakazo/adapter-kit";
import { DEFAULT_COMPUTER_SCREEN } from "@rakazo/core";
import { computerProviders, isKnownSandboxKind, knownSandboxKinds } from "./computer-providers.js";

export type { KnownSandboxKind } from "./computer-providers.js";
export { isKnownSandboxKind, knownSandboxKinds };

/** A stored kind no provider declares anymore reads as a plain remote Linux computer. */
const UNDECLARED_KIND_CAPABILITIES: SandboxKindCapabilities = {
  terminal: false,
  inPlaceUpdate: true,
  nativeShell: false,
  runsOnUserMachine: false,
  screen: DEFAULT_COMPUTER_SCREEN,
  serverHomeMount: "never",
  serverOwnsStoredTeamHome: false,
  storedHomeIsBackup: false,
};

/** Manor's This Mac computer kind: routed per computer, never a SANDBOX_PROVIDER. */
export const LOCAL_SANDBOX_KIND = "local";

/**
 * Manor: a This Mac computer is one shared folder on the person's laptop, reached through the
 * desktop app's `/local-computer` bridge (LocalSandboxProvider). It has no terminal, no screen
 * and no image to update; idle sleep, the allowance and the stored home treat it like any
 * other remote computer, as Manor does today.
 */
const LOCAL_KIND_CAPABILITIES: SandboxKindCapabilities = {
  terminal: false,
  inPlaceUpdate: false,
  nativeShell: false,
  runsOnUserMachine: false,
  screen: DEFAULT_COMPUTER_SCREEN,
  serverHomeMount: "never",
  serverOwnsStoredTeamHome: false,
  storedHomeIsBackup: false,
};

/**
 * Read by the computer's own kind, never from the deployment's provider: one deployment can
 * run computers of several kinds.
 */
export function sandboxKindCapabilities(kind: string | null | undefined): SandboxKindCapabilities {
  if (kind === LOCAL_SANDBOX_KIND) return LOCAL_KIND_CAPABILITIES;
  return isKnownSandboxKind(kind)
    ? computerProviders[kind].capabilities
    : UNDECLARED_KIND_CAPABILITIES;
}

export function sandboxKindsWhere(
  matches: (capabilities: SandboxKindCapabilities) => boolean,
): string[] {
  return knownSandboxKinds.filter((kind) => matches(computerProviders[kind].capabilities));
}
