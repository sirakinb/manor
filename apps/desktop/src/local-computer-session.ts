import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import type { RakazoDesktopLocalComputerStatus } from "@rakazo/contracts";
import {
  isHomeDirectoryShare,
  LOCAL_COMPUTER_DENIED_MESSAGE,
  LOCAL_COMPUTER_HOME_ROOT_MESSAGE,
  localComputerFolderName,
} from "@rakazo/core";
import { executeLocalFolderRpc } from "@rakazo/core/node/local-folder-runtime";
import {
  type BrowserWindow,
  dialog,
  Menu,
  type NativeImage,
  Notification,
  nativeImage,
  Tray,
} from "electron";
import { WebSocket } from "ws";

const LOCAL_COMPUTER_PATH = "/local-computer";
const TRAY_SHARING_TITLE = "Manor is using this Mac";

type RpcIncoming = {
  v?: number;
  type: string;
  id?: string;
  method?: string;
  params?: unknown;
  sessionId?: string;
};

export type LocalComputerSessionHandle = {
  pickFolder: () => Promise<string | null>;
  connect: (input: {
    origin: string;
    token: string;
    folderPath: string;
  }) => Promise<RakazoDesktopLocalComputerStatus>;
  stop: () => Promise<RakazoDesktopLocalComputerStatus>;
  status: () => RakazoDesktopLocalComputerStatus;
};

function websocketUrl(origin: string, token: string): string {
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = LOCAL_COMPUTER_PATH;
  parsed.search = "";
  parsed.hash = "";
  parsed.searchParams.set("token", token);
  return parsed.toString();
}

function summarizeParams(method: string, params: unknown): string {
  if (method === "shell") {
    const argv = (params as { argv?: unknown })?.argv;
    return Array.isArray(argv) ? argv.map(String).join(" ") : "shell";
  }
  if (method === "write_file") {
    return `write ${(params as { path?: unknown })?.path ?? "file"}`;
  }
  return method;
}

export function createLocalComputerSession(opts: {
  getMainWindow: () => BrowserWindow | null;
  notifyRenderer: (status: RakazoDesktopLocalComputerStatus) => void;
  trayIcon?: () => string | NativeImage;
}): LocalComputerSessionHandle {
  let socket: WebSocket | null = null;
  let sharing = false;
  let folderName: string | null = null;
  let folderRoot: string | null = null;
  let lastCommand: string | null = null;
  let tray: Tray | null = null;

  const currentStatus = (): RakazoDesktopLocalComputerStatus => ({
    sharing,
    folderName,
    lastCommand,
  });

  const emit = () => {
    opts.notifyRenderer(currentStatus());
  };

  const destroyTray = () => {
    if (!tray) return;
    tray.destroy();
    tray = null;
  };

  const showSharingTray = () => {
    destroyTray();
    const iconSource = opts.trayIcon?.() ?? nativeImage.createEmpty();
    const icon =
      typeof iconSource === "string" ? nativeImage.createFromPath(iconSource) : iconSource;
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setTitle(TRAY_SHARING_TITLE);
    tray.setToolTip(TRAY_SHARING_TITLE);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: TRAY_SHARING_TITLE, enabled: false },
        {
          label: "Stop",
          click: () => {
            void handle.stop();
          },
        },
      ]),
    );
  };

  const disconnectSocket = () => {
    const current = socket;
    socket = null;
    sharing = false;
    folderRoot = null;
    folderName = null;
    lastCommand = null;
    destroyTray();
    if (current) {
      try {
        if (current.readyState === WebSocket.OPEN) {
          current.send(JSON.stringify({ type: "stop" }));
        }
        current.close();
      } catch {
        /* already closed */
      }
    }
    emit();
  };

  const handle: LocalComputerSessionHandle = {
    pickFolder: async () => {
      const win = opts.getMainWindow();
      const options: Electron.OpenDialogOptions = {
        title: "Share this Mac",
        message: "Pick one folder on this laptop. Manor can use it while this app stays open.",
        properties: ["openDirectory", "createDirectory"],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) return null;
      const folderPath = result.filePaths[0];
      if (!folderPath) return null;
      if (isHomeDirectoryShare(folderPath, homedir())) {
        const box: Electron.MessageBoxOptions = {
          type: "warning",
          title: "Choose a project folder",
          message: LOCAL_COMPUTER_HOME_ROOT_MESSAGE,
        };
        if (win) await dialog.showMessageBox(win, box);
        else await dialog.showMessageBox(box);
        return null;
      }
      return folderPath;
    },

    connect: async (input) => {
      if (typeof input.origin !== "string" || typeof input.token !== "string") {
        return currentStatus();
      }
      if (typeof input.folderPath !== "string" || !existsSync(input.folderPath)) {
        throw new Error("Pick a folder that exists on this Mac.");
      }
      if (isHomeDirectoryShare(input.folderPath, homedir())) {
        throw new Error(LOCAL_COMPUTER_HOME_ROOT_MESSAGE);
      }
      const root = realpathSync(input.folderPath);
      disconnectSocket();
      folderRoot = root;
      folderName = localComputerFolderName(root);
      const url = websocketUrl(input.origin, input.token);
      const next = new WebSocket(url);
      socket = next;

      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => {
          clearTimeout(timer);
          next.off("open", onOpen);
          next.off("error", onError);
          next.off("message", onHello);
          if (socket === next) disconnectSocket();
          reject(error);
        };
        const timer = setTimeout(
          () => fail(new Error("This Mac did not connect in time.")),
          15_000,
        );
        const onOpen = () => {
          next.send(JSON.stringify({ type: "hello", folderName }));
        };
        const onError = () => fail(new Error("Could not reach Manor to share this Mac."));
        const onHello = (raw: WebSocket.RawData) => {
          let message: RpcIncoming;
          try {
            message = JSON.parse(String(raw)) as RpcIncoming;
          } catch {
            fail(new Error("Could not start sharing this Mac."));
            return;
          }
          if (message.type !== "hello_ok") {
            fail(new Error("Could not start sharing this Mac."));
            return;
          }
          clearTimeout(timer);
          next.off("open", onOpen);
          next.off("error", onError);
          next.off("message", onHello);
          sharing = true;
          showSharingTray();
          if (Notification.isSupported()) {
            new Notification({
              title: TRAY_SHARING_TITLE,
              body: `Shared folder: ${folderName}. Stop sharing in Settings.`,
            }).show();
          }
          emit();
          resolve();
        };
        next.once("open", onOpen);
        next.once("error", onError);
        next.once("message", onHello);
      });

      next.on("message", (raw) => {
        void (async () => {
          let message: RpcIncoming;
          try {
            message = JSON.parse(String(raw)) as RpcIncoming;
          } catch {
            return;
          }
          if (message.type !== "rpc" || !message.id || !message.method || !folderRoot) return;
          const commandId = message.id;
          const method = message.method;
          const params = message.params;
          lastCommand = summarizeParams(method, params);
          emit();
          try {
            if (method === "write_file" || method === "shell") {
              const win = opts.getMainWindow();
              const box: Electron.MessageBoxOptions = {
                type: "warning",
                buttons: ["Allow once", "Deny"],
                defaultId: 1,
                cancelId: 1,
                noLink: true,
                title: "Manor wants to change this Mac",
                message:
                  method === "shell"
                    ? "Allow this shell command once on the shared folder?"
                    : "Allow writing a file once in the shared folder?",
                detail: summarizeParams(method, params).slice(0, 800),
              };
              const prompt = win
                ? await dialog.showMessageBox(win, box)
                : await dialog.showMessageBox(box);
              if (prompt.response !== 0) {
                next.send(
                  JSON.stringify({
                    type: "rpc_err",
                    id: commandId,
                    error: LOCAL_COMPUTER_DENIED_MESSAGE,
                  }),
                );
                return;
              }
            }
            const result = await executeLocalFolderRpc({
              root: folderRoot,
              method,
              params,
            });
            next.send(JSON.stringify({ type: "rpc_ok", id: commandId, result }));
          } catch (error) {
            next.send(
              JSON.stringify({
                type: "rpc_err",
                id: commandId,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        })();
      });
      next.on("close", () => {
        if (socket === next) disconnectSocket();
      });

      return currentStatus();
    },

    stop: async () => {
      disconnectSocket();
      return currentStatus();
    },

    status: () => currentStatus(),
  };

  return handle;
}
