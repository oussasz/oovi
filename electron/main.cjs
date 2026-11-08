// oovi desktop app.
// The UI and its backend (bots, tools, browser automation) are a Next.js app.
// Here we run that server inside the app on a private 127.0.0.1 port and show
// it in a native window. Nothing is exposed to the network.

const { app, BrowserWindow, Menu, dialog, nativeTheme, shell } = require("electron");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DEV_URL = process.env.OOVI_DEV_URL; // set by electron/dev.cjs

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let server = null;

/** Start the Next.js production server in this process. Returns its URL. */
async function startServer() {
  // Keys, bots and chats live in the OS app-data folder, e.g. %APPDATA%\oovi\data
  process.env.OOVI_DATA ||= path.join(app.getPath("userData"), "data");
  // Files the bots download land in the user's normal Downloads folder.
  process.env.OOVI_DOWNLOADS ||= path.join(app.getPath("downloads"), "oovi");
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
