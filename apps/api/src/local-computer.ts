import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { RealtimeFanout } from "@rakazo/adapter-kit";
import {
  completeLocalComputerCommand,
  type LocalComputerMethod,
  localComputerSessionTopic,
} from "@rakazo/adapters";
import type { LocalComputerLiveSession, LocalDevice as LocalDeviceDto } from "@rakazo/contracts";
import { LOCAL_COMPUTER_OFFLINE_MESSAGE } from "@rakazo/core";
import { hashLocalDeviceToken, mintLocalDeviceToken } from "@rakazo/core/node/local-device-token";
import { ensureComputerRecord, type PrismaClient } from "@rakazo/db";
import { WebSocket, WebSocketServer } from "ws";

export const LOCAL_COMPUTER_SOCKET_PATH = "/local-computer";

export type LocalComputerUpgradeServer = {
  on(
    event: "upgrade",
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
  off(
    event: "upgrade",
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
};

type ActorIds = { userId: string; spaceId: string };

export async function localComputerLiveSession(
  prisma: PrismaClient,
  actor: ActorIds,
): Promise<LocalComputerLiveSession> {
  const session = await prisma.localComputerSession.findFirst({
    where: { userId: actor.userId, spaceId: actor.spaceId, connected: true, stoppedAt: null },
    orderBy: { startedAt: "desc" },
  });
  return {
    connected: Boolean(session),
    folderName: session?.folderName ?? null,
    lastCommand: session?.lastCommand || null,
  };
}

export async function listLocalDevices(
  prisma: PrismaClient,
  actor: ActorIds,
): Promise<LocalDeviceDto[]> {
  const devices = await prisma.localDevice.findMany({
    where: { userId: actor.userId, spaceId: actor.spaceId },
    include: {
      sessions: {
        where: { connected: true, stoppedAt: null },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return devices.map((device) => ({
    id: device.id,
    name: device.name,
    tokenPrefix: device.tokenPrefix,
    connected: Boolean(device.sessions[0]),
    folderName: device.sessions[0]?.folderName ?? null,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
    revokedAt: device.revokedAt?.toISOString() ?? null,
  }));
}

export async function registerLocalDevice(
  prisma: PrismaClient,
  actor: ActorIds,
  name?: string,
): Promise<{ deviceId: string; token: string; tokenPrefix: string }> {
  const minted = mintLocalDeviceToken();
  const device = await prisma.localDevice.create({
    data: {
      userId: actor.userId,
      spaceId: actor.spaceId,
      name: name?.trim() || "Laptop",
      tokenHash: hashLocalDeviceToken(minted.token),
      tokenPrefix: minted.prefix,
    },
  });
  return { deviceId: device.id, token: minted.token, tokenPrefix: minted.prefix };
}

export async function revokeLocalDevice(
  prisma: PrismaClient,
  actor: ActorIds,
  deviceId: string,
): Promise<void> {
  await prisma.localDevice.updateMany({
    where: { id: deviceId, userId: actor.userId, spaceId: actor.spaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.localComputerSession.updateMany({
    where: { deviceId, userId: actor.userId, spaceId: actor.spaceId, connected: true },
    data: { connected: false, stoppedAt: new Date() },
  });
}

export async function stopLocalComputerSessions(
  prisma: PrismaClient,
  actor: ActorIds,
): Promise<void> {
  await prisma.localComputerSession.updateMany({
    where: { userId: actor.userId, spaceId: actor.spaceId, connected: true },
    data: { connected: false, stoppedAt: new Date() },
  });
}

export async function requireLiveLocalSession(prisma: PrismaClient, actor: ActorIds) {
  const session = await prisma.localComputerSession.findFirst({
    where: { userId: actor.userId, spaceId: actor.spaceId, connected: true, stoppedAt: null },
  });
  if (!session) {
    throw new Error("Open Manor desktop to share this Mac.");
  }
  return session;
}

export function attachLocalComputerSocket(
  server: LocalComputerUpgradeServer,
  deps: { prisma: PrismaClient; realtime: RealtimeFanout },
): () => void {
  const wss = new WebSocketServer({ noServer: true });
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = request.headers.host ?? "localhost";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== LOCAL_COMPUTER_SOCKET_PATH) return;
    const token = url.searchParams.get("token") ?? "";
    wss.handleUpgrade(request, socket, head, (ws) => {
      void handleLocalComputerSocket(ws, token, deps);
    });
  };
  server.on("upgrade", onUpgrade);
  return () => {
    server.off("upgrade", onUpgrade);
    wss.close();
  };
}

async function handleLocalComputerSocket(
  ws: WebSocket,
  token: string,
  deps: { prisma: PrismaClient; realtime: RealtimeFanout },
): Promise<void> {
  let sessionId: string | null = null;
  let unsubscribe: (() => Promise<void>) | undefined;
  const pending = new Map<string, (outcome: { result?: unknown; error?: string }) => void>();
  let inbound: WebSocket.RawData[] | null = [];
  let device: { id: string; userId: string; spaceId: string } | null = null;

  const send = (payload: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  ws.on("message", (raw) => {
    if (inbound) {
      inbound.push(raw);
      return;
    }
    handleMessage(raw);
  });

  ws.on("close", () => {
    void disconnect();
  });

  device = await deps.prisma.localDevice.findFirst({
    where: { tokenHash: hashLocalDeviceToken(token), revokedAt: null },
  });
  if (!device) {
    ws.close(4401, "invalid device token");
    return;
  }

  const buffered = inbound;
  inbound = null;
  for (const raw of buffered ?? []) {
    handleMessage(raw);
  }

  function handleMessage(raw: WebSocket.RawData) {
    const currentDevice = device;
    if (!currentDevice) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    void (async () => {
      if (message.type === "hello") {
        const folderName = String(message.folderName ?? "folder").slice(0, 120);
        await deps.prisma.localComputerSession.updateMany({
          where: { userId: currentDevice.userId, spaceId: currentDevice.spaceId, connected: true },
          data: { connected: false, stoppedAt: new Date() },
        });
        const computer = await ensureComputerRecord(deps.prisma, {
          mode: "local",
          spaceId: currentDevice.spaceId,
          userId: currentDevice.userId,
          kind: "local",
        });
        const session = await deps.prisma.localComputerSession.create({
          data: {
            deviceId: currentDevice.id,
            computerId: computer.id,
            spaceId: currentDevice.spaceId,
            userId: currentDevice.userId,
            folderName,
            connected: true,
          },
        });
        sessionId = session.id;
        await deps.prisma.computer.update({
          where: { id: computer.id },
          data: { kind: "local", state: "running", providerRef: session.id },
        });
        await deps.prisma.localDevice.update({
          where: { id: currentDevice.id },
          data: { lastSeenAt: new Date() },
        });
        unsubscribe = await deps.realtime.subscribe(
          localComputerSessionTopic(session.id),
          (commandId) => {
            void dispatchCommand(commandId);
          },
        );
        send({ v: 1, type: "hello_ok", sessionId: session.id });
        return;
      }
      if (message.type === "rpc_ok" || message.type === "rpc_err") {
        const id = String(message.id ?? "");
        const waiter = pending.get(id);
        pending.delete(id);
        waiter?.(
          message.type === "rpc_err"
            ? { error: String(message.error ?? LOCAL_COMPUTER_OFFLINE_MESSAGE) }
            : { result: message.result },
        );
        return;
      }
      if (message.type === "stop") {
        await disconnect();
        ws.close(1000, "stopped");
      }
    })();
  }

  async function disconnect() {
    await unsubscribe?.();
    unsubscribe = undefined;
    if (sessionId) {
      await deps.prisma.localComputerSession.updateMany({
        where: { id: sessionId, connected: true },
        data: { connected: false, stoppedAt: new Date() },
      });
    }
  }

  async function dispatchCommand(commandId: string) {
    if (!sessionId) return;
    const command = await deps.prisma.localComputerCommand.findFirst({
      where: { id: commandId, sessionId, status: "pending" },
    });
    if (!command) return;
    const method = command.method as LocalComputerMethod;
    send({ v: 1, type: "rpc", id: command.id, method, params: command.params });
    if (method === "shell" || method === "write_file") {
      await deps.prisma.localComputerSession.update({
        where: { id: sessionId },
        data: {
          lastCommand:
            method === "shell"
              ? String((command.params as { argv?: string[] })?.argv?.slice(-1)[0] ?? "shell")
              : `write ${(command.params as { path?: string })?.path ?? "file"}`,
        },
      });
    }
    const outcome = await new Promise<{ result?: unknown; error?: string }>((resolve) => {
      const timer = setTimeout(
        () => resolve({ error: "This Mac did not answer in time." }),
        55_000,
      );
      pending.set(command.id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    await completeLocalComputerCommand(deps.prisma, deps.realtime, command.id, outcome);
  }
}
