// oovi desktop app.
// The UI and its backend (bots, tools, browser automation) are a Next.js app.
// Here we run that server inside the app on a private 127.0.0.1 port and show
// it in a native window. Nothing is exposed to the network.

const { app, BrowserWindow, Menu, Notification, Tray, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, session, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createDesktopControl } = require("./desktop-control.cjs");

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
    void fetch(`${appUrl}/api/crash`, { method: "POST", headers: { "content-type": "application/json", cookie: `${TOKEN_COOKIE}=${LOCAL_TOKEN}` }, body: JSON.stringify({ message: e.message, stack: e.stack, source: "main" }) }).catch(() => {});
  }
}
process.on("uncaughtException", reportMainCrash);
process.on("unhandledRejection", reportMainCrash);

let win = null;
let server = null;
let appUrl = null;
/**
 * A secret for this launch only. The server (in this process) requires it as an HttpOnly cookie on
 * its API, so only oovi's own window can call it: not other programs on this computer, and not a
 * web page (or a bot's browser) pointed at 127.0.0.1.
 */
const LOCAL_TOKEN = crypto.randomBytes(32).toString("hex");
const TOKEN_COOKIE = "oovi_t";
/** True once oovi is really quitting (tray Quit, updater, shutdown): closing the window then closes it. */
let quitting = false;
let tray = null;

// ---------- desktop preferences (read before the window exists) ----------
// Kept outside the account data: it's about this computer, and main.cjs reads it at startup.

const prefsFile = () => path.join(app.getPath("userData"), "desktop-prefs.json");
function readPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}
function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    const tmp = `${prefsFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next));
    fs.renameSync(tmp, prefsFile());
  } catch {
    /* the choice just won't survive a restart */
  }
  return next;
}
/** macOS already keeps running when its window closes; elsewhere it's the user's choice (off by default). */
const backgroundSupported = () => process.platform !== "darwin";
const backgroundOn = () => backgroundSupported() && readPrefs().background === true;

// The tray menu speaks the system language (the page's language isn't known here).
const TRAY_TEXT = {
  en: { open: "Open oovi", quit: "Quit oovi", hint: "oovi is still running in the background, so your routines keep running. Quit it from the oovi icon in the taskbar tray." },
  fr: { open: "Ouvrir oovi", quit: "Quitter oovi", hint: "oovi tourne toujours en arrière-plan, vos routines continuent. Quittez-le depuis l'icône oovi de la zone de notification." },
  ar: { open: "فتح oovi", quit: "إنهاء oovi", hint: "ما زال oovi يعمل في الخلفية، لذا تستمر مهامك المجدولة. أنهِه من أيقونة oovi في منطقة الإشعارات." },
  es: { open: "Abrir oovi", quit: "Salir de oovi", hint: "oovi sigue funcionando en segundo plano, así que tus rutinas siguen activas. Ciérralo desde el icono de oovi en la bandeja del sistema." },
  de: { open: "oovi öffnen", quit: "oovi beenden", hint: "oovi läuft im Hintergrund weiter, deine Routinen laufen also weiter. Beende es über das oovi-Symbol im Infobereich." },
  tr: { open: "oovi'yi aç", quit: "oovi'den çık", hint: "oovi arka planda çalışmaya devam ediyor, rutinlerin çalışmayı sürdürüyor. Sistem tepsisindeki oovi simgesinden çıkabilirsin." },
};
const trayText = () => TRAY_TEXT[String(app.getLocale() || "en").slice(0, 2).toLowerCase()] || TRAY_TEXT.en;

/** Bring the window back (creating it if needed), optionally on an in-app page like /c/<id>. */
function showWindow(target) {
  const safe = typeof target === "string" && /^\/(c\/[\w-]{1,80}|routines)$/.test(target) ? target : null;
  if (!win) {
    createWindow(safe);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (safe) win.webContents.send("oovi:navigate", safe);
}

function setupTray() {
  if (tray || !backgroundOn()) return;
  try {
    let img = nativeImage.createFromPath(path.join(ROOT, "build", "icon.png"));
    if (process.platform !== "darwin") img = img.resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip("oovi");
    const text = trayText();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: text.open, click: () => showWindow() },
        { type: "separator" },
        {
          label: text.quit,
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on("click", () => showWindow());
  } catch {
    tray = null;
  }
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

const liveNotifications = new Set();
// Desktop control (Beta): screenshots, mouse and keyboard, used by the server's lib/desktop-control.ts.
const desktopControl = createDesktopControl({ app, BrowserWindow, screen, desktopCapturer, powerMonitor, dialog, nativeImage });

// The app's own server runs in this process: it reaches these through globalThis.
// Set before the server starts; `npm run web` has no such bridge, and the server skips it.
globalThis.__ooviDesktop = {
  desktop: desktopControl.bridge,
  /** The launch secret the API requires (kept out of the environment, so programs oovi starts can't read it). */
  localToken: LOCAL_TOKEN,
  /** A native notification; clicking it opens oovi on that chat. */
  notify(title, body, chatId) {
    try {
      if (!app.isReady() || !Notification.isSupported()) return;
      const n = new Notification({ title: String(title || "oovi").slice(0, 120), body: String(body || "").slice(0, 300), icon: path.join(ROOT, "build", "icon.png") });
      // Keep a reference until it's gone, or Windows may drop the click handler.
      liveNotifications.add(n);
      n.on("click", () => {
        liveNotifications.delete(n);
        showWindow(typeof chatId === "string" ? `/c/${chatId}` : undefined);
      });
      n.on("close", () => liveNotifications.delete(n));
      n.show();
    } catch {
      /* notifications are a bonus */
    }
  },
};

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

/** target: an in-app page to open on (from showWindow, already checked). */
function createWindow(target) {
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

  // "Keep oovi running in the background": closing hides the window to the tray, so
  // routines keep running. Quitting (tray menu, updater, shutdown) really closes it.
  win.on("close", (event) => {
    if (quitting || !backgroundOn()) return;
    event.preventDefault();
    win?.hide();
    setupTray();
    if (!readPrefs().backgroundHintShown) {
      writePrefs({ backgroundHintShown: true });
      globalThis.__ooviDesktop.notify("oovi", trayText().hint);
    }
  });
  // Windows is signing out or shutting down: don't hold it up.
  win.on("session-end", () => {
    quitting = true;
  });
  win.on("closed", () => {
    win = null;
    // The banner is a window too: it must not keep oovi open once the main window is gone.
    desktopControl.bridge.hideOverlay();
  });
  if (appUrl) void win.loadURL(target ? `${appUrl}${target}` : appUrl);
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

// "Keep oovi running in the background (system tray)": read and change the choice.
const backgroundState = () => ({ supported: backgroundSupported(), on: backgroundOn() });
ipcMain.handle("oovi:background-get", (event) => (isTrusted(event) ? backgroundState() : null));
ipcMain.handle("oovi:background-set", (event, on) => {
  if (!isTrusted(event) || !backgroundSupported()) return null;
  writePrefs({ background: on === true });
  if (on === true) setupTray();
  else destroyTray();
  return backgroundState();
});

app.on("second-instance", () => {
  if (!appUrl && !win) return;
  showWindow();
});

app.whenReady().then(async () => {
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  // Windows notifications need the app's identity (the Store build already has one from its package).
  if (process.platform === "win32" && !process.windowsStore) app.setAppUserModelId(app.isPackaged ? "app.oovi.desktop" : process.execPath);
  setupTray();
  desktopControl.init();
  // After sleep, the server looks for routines that came due meanwhile.
  powerMonitor.on("resume", () => {
    try {
      globalThis.__ooviRoutinesWake?.();
    } catch {
      /* the next tick catches up anyway */
    }
  });
  powerMonitor.on("shutdown", () => {
    quitting = true;
  });
  // The window (with a loading screen) appears at once; the server starts meanwhile.
  if (!DEV_URL) createWindow();
  try {
    appUrl = DEV_URL || (await startServer());
    // The window's session carries the launch secret to the API (see LOCAL_TOKEN).
    if (!DEV_URL) await session.defaultSession.cookies.set({ url: appUrl, name: TOKEN_COOKIE, value: LOCAL_TOKEN, httpOnly: true, sameSite: "strict" });
    if (win) void win.loadURL(appUrl);
    else createWindow();
    require("./updater.cjs").setupUpdates(isTrusted);
  } catch (e) {
    dialog.showErrorBox("oovi couldn't start", String((e && e.stack) || e));
    app.quit();
  }
});

// macOS: closing the window keeps oovi (and any bots still working) running;
// clicking the Dock icon opens the window again. Windows/Linux: closing quits, unless
// "Keep oovi running in the background" is on (then the window only hides, see createWindow).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!win && appUrl) createWindow();
});
app.on("before-quit", () => {
  quitting = true;
  desktopControl.bridge.hideOverlay();
  if (server) server.close();
});
app.on("will-quit", () => destroyTray());
