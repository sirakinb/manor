import { homedir } from "node:os";
import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  TerminalRequest,
  WorkspaceDirectoryRequest,
} from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { cancelComputerRunWork } from "./computer-idle.js";
import { manageComputerWorkspaceDirectories } from "./computer-workspace.js";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { DisconnectedLocalSandboxProvider } from "./local-sandbox.js";
import { createSandboxProvider, type SandboxProviderOptions } from "./sandbox-factory.js";

export function sandboxKindForBot(envKind: string, computerHost: string | null | undefined) {
  if (envKind === "docker" && computerHost === "this-mac") return "desktop";
  return envKind;
}

export function createRunSandbox(
  kind: string,
  opts: SandboxProviderOptions & { prisma?: PrismaClient; localComputer?: SandboxProvider },
): SandboxProvider {
  const local = opts.localComputer ?? new DisconnectedLocalSandboxProvider();
  if (kind === "desktop") {
    return new LocalAwareSandbox(
      new DesktopSandboxProvider({
        root: opts.dataDir,
        hostRoots: [homedir()],
      }),
      local,
    );
  }
  const primary = createSandboxProvider(kind, opts);
  if (kind !== "docker" || !opts.prisma) return new LocalAwareSandbox(primary, local);
  return new LocalAwareSandbox(
    new HostAwareSandbox(
      primary,
      new HostComputerSandbox(opts.hostComputerUrl ?? "", opts.hostComputerToken ?? ""),
      async () => {
        const settings = await opts.prisma!.deploymentSettings.findUnique({
          where: { id: "default" },
        });
        return settings?.computerHost === "this-mac";
      },
    ),
    local,
  );
}

/** Routes attended laptop computers without changing SANDBOX_PROVIDER. */
/**
 * Compile-time guard. The API treats a missing optional provider method as "this computer
 * cannot do that" without any error, so a method the wrapper forgets silently disables a
 * feature (it happened with the page browser and the terminal). When upstream adds a
 * method to SandboxProvider, forward it in LocalAwareSandbox or list it here with a reason.
 */
type NotForwardedByLocalAwareSandbox =
  // Idle detection for local computers is decided separately; see computer-idle.ts.
  "inspectBackgroundWork";
type UnforwardedSandboxMethods = Exclude<
  keyof SandboxProvider,
  keyof LocalAwareSandbox | NotForwardedByLocalAwareSandbox
>;
const allSandboxMethodsForwarded: [UnforwardedSandboxMethods] extends [never] ? true : never = true;
void allSandboxMethodsForwarded;

export class LocalAwareSandbox implements SandboxProvider {
  readonly pageBrowser?: SandboxProvider["pageBrowser"];
  // Optional capabilities are only present when a wrapped provider has them: callers
  // check for the method itself (an absent `connectTerminal` means "no terminal").
  readonly connectTerminal?: SandboxProvider["connectTerminal"];
  readonly isRunning?: SandboxProvider["isRunning"];
  readonly billsWhileRunning?: SandboxProvider["billsWhileRunning"];
  readonly environment?: SandboxProvider["environment"];
  /** Local computers are provisioned only by explicit kind, so this reports the cloud side. */
  readonly provisionKind?: SandboxProvider["provisionKind"];

  constructor(
    /** The provider behind every non-local computer. Tests observe it directly. */
    readonly cloud: SandboxProvider,
    private readonly local: SandboxProvider,
  ) {
    if (cloud.billsWhileRunning || local.billsWhileRunning) {
      this.billsWhileRunning = (computer) =>
        this.route(computer).billsWhileRunning?.(computer) ?? false;
    }
    if (cloud.environment || local.environment) {
      this.environment = async (computer, context) =>
        this.route(computer).environment?.(computer, context);
    }
    if (cloud.provisionKind) {
      this.provisionKind = () => cloud.provisionKind!();
    }
    if (cloud.connectTerminal || local.connectTerminal) {
      this.connectTerminal = (computer, request, context) => {
        const provider = this.route(computer);
        return provider.connectTerminal
          ? provider.connectTerminal(computer, request, context)
          : Promise.reject(new Error("terminal is unavailable on this computer"));
      };
    }
    if (cloud.isRunning || local.isRunning) {
      this.isRunning = async (computer, context) =>
        (await this.route(computer).isRunning?.(computer, context)) ?? false;
    }
    if (cloud.pageBrowser || local.pageBrowser) {
      this.pageBrowser = (computer, request, context) => {
        const provider = this.route(computer);
        return provider.pageBrowser
          ? provider.pageBrowser(computer, request, context)
          : Promise.resolve({
              ok: false,
              uncertain: false,
              fallback: "computer_act",
              error: "Page browser is unavailable on this computer.",
            });
      };
    }
  }

  describe() {
    return this.cloud.describe();
  }

  private route(computer: ComputerRef) {
    return computer.kind === "local" ? this.local : this.cloud;
  }

  async provision(
    request: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
    },
    context: AdapterContext,
  ) {
    const provider = request.providerKind === "local" ? this.local : this.cloud;
    return provider.provision(request, context);
  }

  prepare(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).prepare(computer, context);
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    yield* this.route(computer).execute(computer, request, context);
  }

  // Both fall back to plain commands when the routed provider has no native version,
  // exactly as a caller would against the provider itself.
  workspaceDirectories(
    computer: ComputerRef,
    request: WorkspaceDirectoryRequest,
    context: AdapterContext,
  ) {
    return manageComputerWorkspaceDirectories(this.route(computer), computer, request, context);
  }

  cancelRunWork(computer: ComputerRef, computerId: string, runId: string, context: AdapterContext) {
    return cancelComputerRunWork(this.route(computer), computer, computerId, runId, context);
  }

  connectScreen(computer: ComputerRef, request: ScreenRequest, context: AdapterContext) {
    return this.route(computer).connectScreen(computer, request, context);
  }

  sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    context: AdapterContext,
  ) {
    return this.route(computer).sendInput(computer, input, lease, context);
  }

  observe(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).observe(computer, context);
  }

  act(computer: ComputerRef, request: ComputerActionRequest, context: AdapterContext) {
    return this.route(computer).act(computer, request, context);
  }

  listFiles(computer: ComputerRef, path: string, context: AdapterContext) {
    return this.route(computer).listFiles(computer, path, context);
  }

  readFile(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ) {
    return this.route(computer).readFile(computer, path, context, options);
  }

  writeFile(computer: ComputerRef, file: PortableFile, context: AdapterContext) {
    return this.route(computer).writeFile(computer, file, context);
  }

  exportWorkspace(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).exportWorkspace(computer, context);
  }

  importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ) {
    return this.route(computer).importWorkspace(computer, files, context);
  }

  snapshot(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).snapshot(computer, context);
  }

  keepAlive(computer: ComputerRef) {
    return this.route(computer).keepAlive?.(computer) ?? Promise.resolve();
  }

  releaseScreen(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).releaseScreen?.(computer, context) ?? Promise.resolve();
  }

  setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    context: AdapterContext,
    controlToken?: string,
  ) {
    return (
      this.route(computer).setScreenControl?.(computer, interactive, context, controlToken) ??
      Promise.resolve()
    );
  }

  stop(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).stop(computer, context);
  }

  destroy(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).destroy(computer, context);
  }
}

export class HostAwareSandbox implements SandboxProvider {
  readonly pageBrowser?: SandboxProvider["pageBrowser"];

  constructor(
    private readonly isolated: SandboxProvider,
    private readonly host: SandboxProvider,
    private readonly hostEnabled: () => Promise<boolean>,
  ) {
    if (isolated.pageBrowser || host.pageBrowser) {
      this.pageBrowser = (computer, request, context) => {
        const provider = this.route(computer);
        return provider.pageBrowser
          ? provider.pageBrowser(computer, request, context)
          : Promise.resolve({
              ok: false,
              uncertain: false,
              fallback: "computer_act",
              error: "Page browser is unavailable on this computer.",
            });
      };
    }
  }

  describe() {
    return this.isolated.describe();
  }

  private route(computer: ComputerRef) {
    return computer.kind === "desktop" ? this.host : this.isolated;
  }

  async provisionKind() {
    const provider = (await this.hostEnabled()) ? this.host : this.isolated;
    return provider.describe().id as ComputerRef["kind"];
  }

  async provision(
    request: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
    },
    context: AdapterContext,
  ) {
    const provider = (await this.hostEnabled()) ? this.host : this.isolated;
    const providerKind = provider.describe().id;
    return provider.provision(
      {
        ...request,
        providerRef: request.providerKind === providerKind ? request.providerRef : undefined,
      },
      context,
    );
  }

  async isRunning(computer: ComputerRef, context: AdapterContext): Promise<boolean> {
    const provider = (await this.hostEnabled()) ? this.host : this.isolated;
    if (provider.describe().id !== computer.kind) return false;
    return provider.isRunning?.(computer, context) ?? false;
  }

  async environment(computer: ComputerRef, context: AdapterContext) {
    const provider = this.route(computer);
    return provider.environment?.(computer, context);
  }

  prepare(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).prepare(computer, context);
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    if (computer.kind === "desktop" && !(await this.hostEnabled()))
      throw new Error("Local computer access is disabled");
    yield* this.route(computer).execute(computer, request, context);
  }

  workspaceDirectories(
    computer: ComputerRef,
    request: WorkspaceDirectoryRequest,
    context: AdapterContext,
  ) {
    return manageComputerWorkspaceDirectories(this.route(computer), computer, request, context);
  }

  cancelRunWork(computer: ComputerRef, computerId: string, runId: string, context: AdapterContext) {
    return cancelComputerRunWork(this.route(computer), computer, computerId, runId, context);
  }

  connectScreen(computer: ComputerRef, request: ScreenRequest, context: AdapterContext) {
    return this.route(computer).connectScreen(computer, request, context);
  }

  connectTerminal(computer: ComputerRef, request: TerminalRequest, context: AdapterContext) {
    const provider = this.route(computer);
    if (!provider.connectTerminal) {
      return Promise.reject(new Error("terminal is unavailable on this computer"));
    }
    return provider.connectTerminal(computer, request, context);
  }

  sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    context: AdapterContext,
  ) {
    return this.route(computer).sendInput(computer, input, lease, context);
  }

  observe(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).observe(computer, context);
  }

  act(computer: ComputerRef, request: ComputerActionRequest, context: AdapterContext) {
    return this.route(computer).act(computer, request, context);
  }

  listFiles(computer: ComputerRef, path: string, context: AdapterContext) {
    return this.route(computer).listFiles(computer, path, context);
  }

  readFile(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ) {
    return this.route(computer).readFile(computer, path, context, options);
  }

  writeFile(computer: ComputerRef, file: PortableFile, context: AdapterContext) {
    return this.route(computer).writeFile(computer, file, context);
  }

  exportWorkspace(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).exportWorkspace(computer, context);
  }

  importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ) {
    return this.route(computer).importWorkspace(computer, files, context);
  }

  snapshot(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).snapshot(computer, context);
  }

  billsWhileRunning(computer: ComputerRef): boolean {
    return this.route(computer).billsWhileRunning?.(computer) ?? false;
  }

  keepAlive(computer: ComputerRef) {
    return this.route(computer).keepAlive?.(computer) ?? Promise.resolve();
  }

  releaseScreen(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).releaseScreen?.(computer, context) ?? Promise.resolve();
  }

  setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    context: AdapterContext,
    controlToken?: string,
  ) {
    return (
      this.route(computer).setScreenControl?.(computer, interactive, context, controlToken) ??
      Promise.resolve()
    );
  }

  stop(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).stop(computer, context);
  }

  destroy(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).destroy(computer, context);
  }
}
