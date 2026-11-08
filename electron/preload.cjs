// Bridge for the few things the page needs from the desktop app.
// Runs sandboxed; exposes only these functions, never Node or Electron itself.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oovi", {
  /** Native "choose folder" dialog. Resolves to the folder's path, or null if cancelled. */
  pickFolder: (current) => ipcRenderer.invoke("oovi:pick-folder", typeof current === "string" ? current : undefined),
});
