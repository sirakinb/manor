import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { closeLocalComputerSocket, localComputerWebsocketUrl } from "./local-computer-socket.js";

function mockSocket(readyState: number) {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  };
}

describe("local computer socket", () => {
  it("builds a wss URL on the origin /local-computer path", () => {
    expect(localComputerWebsocketUrl("https://manor.pentridgemedia.com", "probe")).toBe(
      "wss://manor.pentridgemedia.com/local-computer?token=probe",
    );
    expect(localComputerWebsocketUrl("http://127.0.0.1:5173", "probe")).toBe(
      "ws://127.0.0.1:5173/local-computer?token=probe",
    );
  });

  it("does not call close() on a CONNECTING socket", () => {
    const socket = mockSocket(WebSocket.CONNECTING);
    closeLocalComputerSocket(socket);
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it("sends stop then close() on an OPEN socket", () => {
    const socket = mockSocket(WebSocket.OPEN);
    closeLocalComputerSocket(socket);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "stop" }));
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();
  });
});
