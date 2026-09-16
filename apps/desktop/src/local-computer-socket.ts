import { WebSocket } from "ws";

const LOCAL_COMPUTER_PATH = "/local-computer";

export type LocalComputerSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  terminate: () => void;
};

export function localComputerWebsocketUrl(origin: string, token: string): string {
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = LOCAL_COMPUTER_PATH;
  parsed.search = "";
  parsed.hash = "";
  parsed.searchParams.set("token", token);
  return parsed.toString();
}

export function closeLocalComputerSocket(socket: LocalComputerSocketLike | null | undefined): void {
  if (!socket) return;
  try {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
      socket.close();
      return;
    }
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
  } catch {
    /* already closed */
  }
}
