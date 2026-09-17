import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForLocalComputerHello } from "./local-computer-handshake.js";

function fakeSocket() {
  const socket = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
  socket.send = vi.fn();
  return socket;
}

describe("waitForLocalComputerHello", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails immediately when the API closes with 4401", async () => {
    const socket = fakeSocket();
    const pending = waitForLocalComputerHello(socket, "Docs");
    socket.emit("open");
    socket.emit("close", 4401, "invalid device token");
    await expect(pending).rejects.toThrow("Manor rejected this Mac's share token.");
  });

  it("resolves on hello_ok", async () => {
    const socket = fakeSocket();
    const pending = waitForLocalComputerHello(socket, "Docs");
    socket.emit("open");
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "hello", folderName: "Docs" }));
    socket.emit("message", JSON.stringify({ v: 1, type: "hello_ok", sessionId: "s1" }));
    await pending;
  });

  it("times out when the server stays silent", async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const pending = waitForLocalComputerHello(socket, "Docs");
    socket.emit("open");
    const assertion = expect(pending).rejects.toThrow("This Mac did not connect in time.");
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
