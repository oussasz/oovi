// oovi desktop app.
// The UI and its backend (bots, tools, browser automation) are a Next.js app.
// Here we run that server inside the app on a private 127.0.0.1 port and show
// it in a native window. Nothing is exposed to the network.

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DEV_URL = process.env.OOVI_DEV_URL; // set by electron/dev.cjs
/** Installed app: the trimmed Next.js server in resources/server. From source (`npm start`): the project. */
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, "server") : ROOT;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Faster starts after the first: V8 keeps the compiled server code on disk between launches.
try {
  require("node:module").enableCompileCache?.(path.join(app.getPath("userData"), "code-cache"));
} catch {
  /* older runtime: it just compiles every time */
}

// Crash reporting for the desktop shell itself: log locally, and hand the error
// to the app's own server, which sends it on only if the user allows it.
function reportMainCrash(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  try {
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
let appUrl = null;

/** Start the Next.js production server in this process. Returns its URL. */
async function startServer() {
  // Keys, bots and chats live in the OS app-data folder, e.g. %APPDATA%\oovi\data
  process.env.OOVI_DATA ||= path.join(app.getPath("userData"), "data");
  // Files the bots download land in the user's normal Downloads folder.
  process.env.OOVI_DOWNLOADS ||= path.join(app.getPath("downloads"), "oovi");
  process.env.OOVI_VERSION ||= app.getVersion();
  process.chdir(SERVER_DIR);

  let createNext;
  let conf;
  if (app.isPackaged) {
    // The standalone build carries its settings in required-server-files.json (what its own server.js does).
    process.env.NODE_ENV = "production";
    conf = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, ".next", "required-server-files.json"), "utf8")).config;
    process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(conf);
    createNext = require(path.join(SERVER_DIR, "node_modules", "next"));
  } else {
    createNext = require("next");
  }

  const srv = http.createServer();
  await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", resolve);
  });
  const { port } = srv.address();
  const nextApp = createNext({ dev: false, dir: SERVER_DIR, hostname: "127.0.0.1", port, ...(conf ? { conf } : {}) });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();
  srv.on("request", (req, res) => handle(req, res));
  server = srv;
  return `http://127.0.0.1:${port}`;
}

/** Shown the moment oovi starts, while the server gets ready (a second or two). */
function loadingPage(dark) {
  const bg = dark ? "#131312" : "#fbfaf7";
  const fg = dark ? "#f2f1ec" : "#171717";
  const track = dark ? "#2a2a28" : "#e9e7e0";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>oovi</title><style>
html,body{margin:0;height:100%;background:${bg};color:${fg};font:600 15px system-ui,-apple-system,"Segoe UI",sans-serif}
body{display:grid;place-items:center}.w{display:grid;justify-items:center;gap:18px}
.n{font-size:34px;font-weight:800;letter-spacing:-.02em}.b{width:120px;height:4px;border-radius:4px;background:${track};overflow:hidden}
.b i{display:block;width:40%;height:100%;border-radius:4px;background:${fg};animation:m 1.1s ease-in-out infinite}
@keyframes m{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){.b i{animation:none;width:100%;opacity:.35}}
</style></head><body><div class="w"><div class="n">oovi</div><div class="b"><i></i></div></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: "oovi",
    icon: path.join(ROOT, "build", "icon.png"),
    backgroundColor: dark ? "#131312" : "#fbfaf7",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
  });
  win.once("ready-to-show", () => win?.show());

  // Links to the web open in the user's normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (appUrl && target.startsWith(new URL(appUrl).origin)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
  });

  win.on("closed", () => {
    win = null;
  });
  if (appUrl) void win.loadURL(appUrl);
  else void win.loadURL(loadingPage(dark));
}

/** Only the app's own page may use the desktop bridge. */
function isTrusted(event) {
  try {
    return !!appUrl && new URL(event.senderFrame?.url ?? "").origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

// "Choose a project folder" for a chat.
ipcMain.handle("oovi:pick-folder", async (event, current) => {
  if (!isTrusted(event)) return null;
  const opts = { title: "Choose a project folder", buttonLabel: "Use this folder", properties: ["openDirectory", "createDirectory"], ...(typeof current === "string" ? { defaultPath: current } : {}) };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

// Open / reveal files the bots created. Documents only: never programs or scripts.
const OPENABLE = /\.(docx?|xlsx?|pptx?|pdf|csv|tsv|md|txt|html?|json|png|jpe?g|gif|webp|svg)$/i;
function safeFile(p) {
  try {
    return typeof p === "string" && path.isAbsolute(p) && OPENABLE.test(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
ipcMain.handle("oovi:open-file", async (event, p) => {
  if (!isTrusted(event) || !safeFile(p)) return "That file can't be opened.";
  return shell.openPath(p); // "" when it worked
});
ipcMain.handle("oovi:show-file", async (event, p) => {
  if (!isTrusted(event) || !safeFile(p)) return false;
  shell.showItemInFolder(p);
  return true;
});

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  // The window (with a loading screen) appears at once; the server starts meanwhile.
  if (!DEV_URL) createWindow();
  try {
    appUrl = DEV_URL || (await startServer());
    if (win) void win.loadURL(appUrl);
    else createWindow();
    require("./updater.cjs").setupUpdates(isTrusted);
  } catch (e) {
    dialog.showErrorBox("oovi couldn't start", String((e && e.stack) || e));
    app.quit();
  }
});

// macOS: closing the window keeps oovi (and any bots still working) running;
// clicking the Dock icon opens the window again. Windows/Linux: closing quits.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!win && appUrl) createWindow();
});
app.on("before-quit", () => {
  if (server) server.close();
});
