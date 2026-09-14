import type { RealtimeFanout } from "@rakazo/adapter-kit";
import { LOCAL_COMPUTER_OFFLINE_MESSAGE } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

export const LOCAL_COMPUTER_METHODS = ["list_files", "read_file", "write_file", "shell"] as const;
export type LocalComputerMethod = (typeof LOCAL_COMPUTER_METHODS)[number];

export interface LocalComputerGateway {
  invoke(
    sessionId: string,
    method: LocalComputerMethod,
    params: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
}

const RESULT_TOPIC = (commandId: string) => `local-computer.result.${commandId}`;
const SESSION_TOPIC = (sessionId: string) => `local-computer.session.${sessionId}`;
const DEFAULT_TIMEOUT_MS = 60_000;

export class DurableLocalComputerGateway implements LocalComputerGateway {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly realtime: RealtimeFanout,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async invoke(
    sessionId: string,
    method: LocalComputerMethod,
    params: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const session = await this.prisma.localComputerSession.findFirst({
      where: { id: sessionId, connected: true, stoppedAt: null },
      select: { id: true },
    });
    if (!session) throw new Error(LOCAL_COMPUTER_OFFLINE_MESSAGE);

    const command = await this.prisma.localComputerCommand.create({
      data: { sessionId, method, params: params as object, status: "pending" },
    });

    const result = waitForCommandResult(
      this.prisma,
      this.realtime,
      command.id,
      this.timeoutMs,
      signal,
    );
    await this.realtime.publish(SESSION_TOPIC(sessionId), command.id);
    return result;
  }
}

export async function waitForCommandResult(
  prisma: PrismaClient,
  realtime: RealtimeFanout,
  commandId: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => Promise<void>) | undefined;
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      void unsubscribe?.();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => finish(new Error("Local computer command cancelled"));
    const timer = setTimeout(
      () => finish(new Error("This Mac did not answer in time. Is Manor desktop still sharing?")),
      timeoutMs,
    );
    signal.addEventListener("abort", onAbort, { once: true });

    const poll = async () => {
      const row = await prisma.localComputerCommand.findUnique({ where: { id: commandId } });
      if (!row || row.status !== "done") return;
      if (row.error) finish(new Error(row.error));
      else finish(null, row.result);
    };

    void realtime
      .subscribe(RESULT_TOPIC(commandId), () => {
        void poll();
      })
      .then((stop) => {
        unsubscribe = stop;
        void poll();
      })
      .catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

export async function completeLocalComputerCommand(
  prisma: PrismaClient,
  realtime: RealtimeFanout,
  commandId: string,
  outcome: { result?: unknown; error?: string },
): Promise<void> {
  await prisma.localComputerCommand.update({
    where: { id: commandId },
    data: {
      status: "done",
      result: outcome.error ? undefined : ((outcome.result as object | undefined) ?? {}),
      error: outcome.error ?? null,
      completedAt: new Date(),
    },
  });
  await realtime.publish(RESULT_TOPIC(commandId), commandId);
}

export function localComputerSessionTopic(sessionId: string): string {
  return SESSION_TOPIC(sessionId);
}

export class MemoryLocalComputerGateway implements LocalComputerGateway {
  private readonly handlers = new Map<
    string,
    (method: LocalComputerMethod, params: unknown, signal: AbortSignal) => Promise<unknown>
  >();

  register(
    sessionId: string,
    handler: (
      method: LocalComputerMethod,
      params: unknown,
      signal: AbortSignal,
    ) => Promise<unknown>,
  ): void {
    this.handlers.set(sessionId, handler);
  }

  unregister(sessionId: string): void {
    this.handlers.delete(sessionId);
  }

  async invoke(
    sessionId: string,
    method: LocalComputerMethod,
    params: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const handler = this.handlers.get(sessionId);
    if (!handler) throw new Error(LOCAL_COMPUTER_OFFLINE_MESSAGE);
    return handler(method, params, signal);
  }
}
