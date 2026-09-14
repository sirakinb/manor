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
} from "@rakazo/adapter-kit";
import { LOCAL_COMPUTER_GUI_MESSAGE, LOCAL_COMPUTER_OFFLINE_MESSAGE } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { placeholderObservation } from "./computer-support.js";
import type { LocalComputerGateway, LocalComputerMethod } from "./local-computer-gateway.js";

const GUI_ERROR = new Error(LOCAL_COMPUTER_GUI_MESSAGE);

export class LocalSandboxProvider implements SandboxProvider {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: LocalComputerGateway,
  ) {}

  describe() {
    return {
      id: "local",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: false,
        pty: false,
        snapshots: false,
        takeover: false,
        persistentHome: false,
        multiScreen: false,
      },
    };
  }

  async provision(
    request: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
    },
    context: AdapterContext,
  ): Promise<ComputerRef> {
    const session = await this.connectedSession(context, request.providerRef);
    return {
      id: session.id,
      botId: request.botId,
      kind: "local",
      providerRef: session.id,
      fresh: false,
    };
  }

  async prepare(_computer: ComputerRef, _context: AdapterContext): Promise<void> {}

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const result = (await this.rpc(
      computer,
      "shell",
      {
        argv: request.argv,
        cwd: request.cwd ?? "",
        timeoutMs: request.timeoutMs,
      },
      context,
    )) as { stdout?: string; stderr?: string; code?: number };
    if (result.stdout) yield { type: "stdout", data: result.stdout };
    if (result.stderr) yield { type: "stderr", data: result.stderr };
    yield { type: "exit", code: result.code ?? 1 };
  }

  async connectScreen(): Promise<never> {
    throw GUI_ERROR;
  }

  async sendInput(): Promise<void> {
    throw GUI_ERROR;
  }

  async observe() {
    return placeholderObservation("local-folder");
  }

  async act(_computer: ComputerRef, _request: ComputerActionRequest): Promise<never> {
    throw GUI_ERROR;
  }

  async listFiles(computer: ComputerRef, path: string, context: AdapterContext) {
    const entries = (await this.rpc(computer, "list_files", { path }, context)) as Array<{
      path: string;
      kind: "file" | "dir";
      size: number;
    }>;
    return entries;
  }

  async readFile(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ): Promise<Uint8Array> {
    const result = (await this.rpc(
      computer,
      "read_file",
      { path, maxBytes: options?.maxBytes },
      context,
    )) as { contentBase64: string };
    return Uint8Array.from(Buffer.from(result.contentBase64, "base64"));
  }

  async writeFile(
    computer: ComputerRef,
    file: PortableFile,
    context: AdapterContext,
  ): Promise<void> {
    await this.rpc(
      computer,
      "write_file",
      { path: file.path, contentBase64: Buffer.from(file.content).toString("base64") },
      context,
    );
  }

  async *exportWorkspace(): AsyncIterable<PortableFile> {}

  async importWorkspace(): Promise<void> {}

  async snapshot() {
    return { id: "local", createdAt: new Date().toISOString() };
  }

  async stop(): Promise<void> {}

  async destroy(): Promise<void> {}

  private async connectedSession(context: AdapterContext, providerRef?: string) {
    const session = await this.prisma.localComputerSession.findFirst({
      where: {
        userId: context.userId,
        spaceId: context.spaceId,
        connected: true,
        stoppedAt: null,
        ...(providerRef ? { id: providerRef } : {}),
      },
      orderBy: { startedAt: "desc" },
    });
    if (!session) throw new Error(LOCAL_COMPUTER_OFFLINE_MESSAGE);
    return session;
  }

  private rpc(
    computer: ComputerRef,
    method: LocalComputerMethod,
    params: unknown,
    context: AdapterContext,
  ) {
    if (computer.kind !== "local") throw new Error(LOCAL_COMPUTER_OFFLINE_MESSAGE);
    return this.gateway.invoke(computer.providerRef, method, params, context.signal);
  }
}

export class DisconnectedLocalSandboxProvider implements SandboxProvider {
  describe() {
    return {
      id: "local",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: false,
        pty: false,
        snapshots: false,
        takeover: false,
        persistentHome: false,
        multiScreen: false,
      },
    };
  }

  private fail(): never {
    throw new Error(LOCAL_COMPUTER_OFFLINE_MESSAGE);
  }

  async provision(): Promise<ComputerRef> {
    this.fail();
  }
  async prepare(): Promise<void> {
    this.fail();
  }
  execute(): AsyncIterable<ProcessEvent> {
    this.fail();
  }
  async connectScreen(): Promise<never> {
    this.fail();
  }
  async sendInput(_c: ComputerRef, _i: ComputerInput, _l: ControlLeaseRef): Promise<void> {
    this.fail();
  }
  async observe(): Promise<never> {
    this.fail();
  }
  async act(): Promise<never> {
    this.fail();
  }
  async listFiles(): Promise<never> {
    this.fail();
  }
  async readFile(): Promise<never> {
    this.fail();
  }
  async writeFile(): Promise<void> {
    this.fail();
  }
  exportWorkspace(): AsyncIterable<PortableFile> {
    this.fail();
  }
  async importWorkspace(): Promise<void> {
    this.fail();
  }
  async snapshot(): Promise<never> {
    this.fail();
  }
  async stop(): Promise<void> {
    this.fail();
  }
  async destroy(): Promise<void> {
    this.fail();
  }
}
