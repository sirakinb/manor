const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoDesktop", {
  platform: process.platform,
  window: {
    close: () => ipcRenderer.invoke("desktop.window.close"),
    minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
    toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
    state: () => ipcRenderer.invoke("desktop.window.state"),
  },
  update: {
    state: () => ipcRenderer.invoke("desktop.update.state"),
    check: () => ipcRenderer.invoke("desktop.update.check"),
    download: () => ipcRenderer.invoke("desktop.update.download"),
    install: () => ipcRenderer.invoke("desktop.update.install"),
  },
  oauth: {
    onCallback: (listener) => {
      // The IpcRendererEvent stays in the preload: the renderer only sees the code.
      const handler = (_event, callback) => listener(callback);
      ipcRenderer.on("desktop.oauth.callback", handler);
      return () => ipcRenderer.off("desktop.oauth.callback", handler);
    },
  },
  localComputer: {
    pickFolder: () => ipcRenderer.invoke("desktop.localComputer.pickFolder"),
    connect: (input) => ipcRenderer.invoke("desktop.localComputer.connect", input),
    stop: () => ipcRenderer.invoke("desktop.localComputer.stop"),
    status: () => ipcRenderer.invoke("desktop.localComputer.status"),
    onChange: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on("desktop.localComputer.change", handler);
      return () => ipcRenderer.off("desktop.localComputer.change", handler);
    },
  },
});
