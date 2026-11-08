// oovi desktop app.
// The UI and its backend (bots, tools, browser automation) are a Next.js app.
// Here we run that server inside the app on a private 127.0.0.1 port and show
// it in a native window. Nothing is exposed to the network.

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require("electron");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DEV_URL = process.env.OOVI_DEV_URL; // set by electron/dev.cjs

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Crash reporting for the desktop shell itself: log locally, and hand the error
// to the app's own server, which sends it on only if the user allows it.
function reportMainCrash(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  try {
    const fs = require("node:fs");
    const dir = process.env.OOVI_DATA || path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "crash.log"), `${JSON.stringify({ at: new Date().toISOString(), source: "main", message: e.message, stack: e.stack })}\n`);
  } catch {
    /* ignore */
  }
  if (appUrl) {
    void fetch(`${appUrl}/api/crash`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: e.message, stack: e.stack, source: "main" }) }).catch(() => {});
  }
}
process.on("uncaughtException", reportMainCrash);
process.on("unhandledRejection", reportMainCrash);

let win = null;
let server = null;

/** Start the Next.js production server in this process. Returns its URL. */
async function startServer() {
  // Keys, bots and chats live in the OS app-data folder, e.g. %APPDATA%\oovi\data
  process.env.OOVI_DATA ||= path.join(app.getPath("userData"), "data");
  // Files the bots download land in the user's normal Downloads folder.
  process.env.OOVI_DOWNLOADS ||= path.join(app.getPath("downloads"), "oovi");
  process.env.OOVI_VERSION ||= app.getVersion();
  process.chdir(ROOT);

  const next = require("next");
  const srv = http.createServer();
  await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", resolve);
  });
  const { port } = srv.address();
  const nextApp = next({ dev: false, dir: ROOT, hostname: "127.0.0.1", port });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();
  srv.on("request", (req, res) => handle(req, res));
  server = srv;
  return `http://127.0.0.1:${port}`;
}

function createWindow(url) {
  const origin = new URL(url).origin;
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: "oovi",
    icon: path.join(ROOT, "build", "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#131312" : "#fbfaf7",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
  });
  win.once("ready-to-show", () => win.show());

  // Links to the web open in the user's normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (target.startsWith(origin)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
  });

  win.on("closed", () => {
    win = null;
  });
  void win.loadURL(url);
}

// "Choose a project folder" for a chat. Only the app's own page may ask.
ipcMain.handle("oovi:pick-folder", async (event, current) => {
  try {
    if (!appUrl || new URL(event.senderFrame?.url ?? "").origin !== new URL(appUrl).origin) return null;
  } catch {
    return null;
  }
  const opts = { title: "Choose a project folder", buttonLabel: "Use this folder", properties: ["openDirectory", "createDirectory"], ...(typeof current === "string" ? { defaultPath: current } : {}) };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  try {
    appUrl = DEV_URL || (await startServer());
    createWindow(appUrl);
  } catch (e) {
    dialog.showErrorBox("oovi couldn't start", String((e && e.stack) || e));
    app.quit();
  }
});

let appUrl = null;

// macOS: closing the window keeps oovi (and any bots still working) running;
// clicking the Dock icon opens the window again. Windows/Linux: closing quits.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!win && appUrl) createWindow(appUrl);
});
app.on("before-quit", () => {
  if (server) server.close();
});
