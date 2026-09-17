const HELLO_TIMEOUT_MS = 15_000;

export type LocalComputerHandshakeSocket = {
  send: (data: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

function closeReasonText(reason: unknown): string {
  if (reason == null) return "";
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(reason)) {
    return reason.toString("utf8").trim();
  }
  if (typeof reason === "string") return reason.trim();
  return String(reason).trim();
}

export function waitForLocalComputerHello(
  socket: LocalComputerHandshakeSocket,
  folderName: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      if (error) reject(error);
      else resolve();
    };

    function onOpen() {
      socket.send(JSON.stringify({ type: "hello", folderName }));
    }
    function onError() {
      finish(new Error("Could not reach Manor to share this Mac."));
    }
    function onMessage(raw: unknown) {
      let message: { type?: string };
      try {
        message = JSON.parse(String(raw)) as { type?: string };
      } catch {
        finish(new Error("Could not start sharing this Mac."));
        return;
      }
      if (message.type !== "hello_ok") {
        finish(new Error("Could not start sharing this Mac."));
        return;
      }
      finish();
    }
    function onClose(code: unknown, reason?: unknown) {
      const closeCode = typeof code === "number" ? code : Number(code);
      const reasonText = closeReasonText(reason);
      if (closeCode === 4401 || reasonText === "invalid device token") {
        finish(new Error("Manor rejected this Mac's share token."));
        return;
      }
      const detail = reasonText ? `${closeCode}: ${reasonText}` : String(closeCode);
      finish(new Error(`Manor closed the share connection (${detail}).`));
    }

    timer = setTimeout(
      () => finish(new Error("This Mac did not connect in time.")),
      HELLO_TIMEOUT_MS,
    );
    socket.on("open", onOpen);
    socket.on("error", onError);
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}
