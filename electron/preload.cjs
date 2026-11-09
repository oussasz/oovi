// Bridge for the few things the page needs from the desktop app.
// Runs sandboxed; exposes only these functions, never Node or Electron itself.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oovi", {
  /** Native "choose folder" dialog. Resolves to the folder's path, or null if cancelled. */
  pickFolder: (current) => ipcRenderer.invoke("oovi:pick-folder", typeof current === "string" ? current : undefined),

  /** Open a file the bots created, with its normal app (Word, Excel…), or show it in its folder. */
  openFile: (p) => ipcRenderer.invoke("oovi:open-file", String(p ?? "")),
  showFile: (p) => ipcRenderer.invoke("oovi:show-file", String(p ?? "")),

  /** App updates (see electron/updater.cjs). */
  updates: {
    get: () => ipcRenderer.invoke("oovi:update-get"),
    check: () => ipcRenderer.invoke("oovi:update-check"),
    /** Windows: download and install (restarts oovi). Mac: open the download page. */
    start: () => ipcRenderer.invoke("oovi:update-start"),
    setAuto: (on) => ipcRenderer.invoke("oovi:update-auto", on === true),
    /** Calls back with the new state on every change. Returns an unsubscribe function. */
    onChange: (cb) => {
      const fn = (_e, state) => cb(state);
      ipcRenderer.on("oovi:update", fn);
      return () => ipcRenderer.removeListener("oovi:update", fn);
    },
  },
});
