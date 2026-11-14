// App updates.
//
// New versions come from the oovi website (https://oovi.conuron.com/updates, which serves
// latest.yml and hands out the installers), and "What's new" opens https://oovi.conuron.com/changelog.
// The app never talks to GitHub. (Up to 0.8.8 it read the public repo oussasz/oovi-downloads.)
// - Windows (installed app): electron-updater downloads the new installer, checks
//   its SHA-512 against latest.yml and installs it over the old version. The
//   user's data lives in the app-data folder, which the installer never touches.
// - Mac, and any build that can't self-install: we only check the version and
//   send the user to the download page (Mac apps must be code-signed to update
//   themselves).
// - Microsoft Store builds: the Store updates the app; oovi does nothing.
//
// "Install updates automatically" (on by default) downloads new versions in the
// background; the banner then offers "Restart now". An update is NEVER installed by
// itself when oovi closes: that ran the installer while Windows was shutting down or
// the user had moved on, and an installer stopped half-way (it removes the old
// version first) left people without oovi.
//
// "Update now" / "Restart now" on Windows:
//   1. The page switches to "Updating oovi to X... oovi will restart by itself".
//   2. oovi closes and runs the downloaded installer (one-click NSIS, per user) with
//      --updated: it shows its own small progress window, then starts oovi again.
//   3. On the next start oovi says "oovi was updated to X" once, and puts back a
//      desktop / Start-menu shortcut that existed before the update if it went missing.
//
// Installs "for all users" (under Program Files, possible with installers before 0.8.7)
// need administrator rights to update, so they get the download page instead.

const { app, ipcMain, shell, BrowserWindow, powerMonitor } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SITE = "https://oovi.conuron.com";
const FEED = `${SITE}/updates`;
const FIRST_CHECK_MS = 15_000;
// The banner must appear by itself, without opening Settings: check every 30 minutes, and again when the
// user comes back to oovi (window focused, computer woken up or unlocked) if the last check is 10+ minutes old.
// A check is one small file (latest.yml, ~400 bytes, cached 60 s by the website).
const CHECK_EVERY_MS = 30 * 60 * 1000;
const RECHECK_ON_RETURN_MS = 10 * 60 * 1000;
const APP_ID = "app.oovi.desktop"; // package.json build.appId (the shortcuts' AppUserModelID)
const SHORTCUT = "oovi.lnk"; // package.json build.nsis.shortcutName
const releaseUrl = (v) => `${SITE}/changelog#v${String(v).replace(/^v/, "")}`;

// Installed from the Microsoft Store: the Store updates the app, so oovi doesn't.
const fromStore = !!process.windowsStore;
/** Installed "for all users" under Program Files: updating needs administrator rights. */
function installedForAllUsers() {
  const exe = process.execPath.toLowerCase();
  return [process.env.ProgramFiles, process.env.ProgramW6432, process.env["ProgramFiles(x86)"]]
    .filter(Boolean)
    .some((dir) => exe.startsWith(`${String(dir).toLowerCase()}\\`));
}
const canSelfInstall = process.platform === "win32" && app.isPackaged && !fromStore && !installedForAllUsers();
const prefsFile = () => path.join(app.getPath("userData"), "update.json");

/** { auto, lastVersion, shortcuts }: lastVersion is the version that ran last time. */
function loadPrefs() {
  try {
    const j = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
    return {
      auto: j.auto !== false,
      lastVersion: typeof j.lastVersion === "string" ? j.lastVersion : null,
      shortcuts: j.shortcuts && typeof j.shortcuts === "object" ? j.shortcuts : null,
    };
  } catch {
    return { auto: true, lastVersion: null, shortcuts: null };
  }
}

function savePrefs(p) {
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify(p));
  } catch {
    /* not fatal */
  }
}

/** -1, 0 or 1. Handles "v1.2.3" and plain "1.2.3"; pre-release suffixes are ignored. */
function compare(a, b) {
  const pa = String(a).replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}

/** Installed from the .deb package (under /opt): the .deb is the file to get again. Otherwise the AppImage. */
const linuxTarget = () => (process.env.APPIMAGE ? "linux-appimage" : "linux-deb");
const downloadPage = () =>
  `${SITE}/download/${process.platform === "darwin" ? (process.arch === "arm64" ? "mac-arm64" : "mac-intel") : process.platform === "linux" ? linuxTarget() : "windows"}`;

let prefs = { auto: true, lastVersion: null, shortcuts: null };
let updater = null; // electron-updater's autoUpdater (Windows only)
let installWhenReady = false;
let installing = false;
let checking = false;

/**
 * status: idle | checking | none | available | downloading | ready | installing | error
 * canInstall: oovi can install it itself (Windows); otherwise "Download" opens the website.
 * updatedTo: set for this run only, right after oovi restarted into a new version.
 */
let state = {
  status: "idle",
  current: app.getVersion(),
  version: null,
  progress: 0,
  error: null,
  auto: true,
  canInstall: canSelfInstall,
  store: fromStore,
  platform: process.platform,
  notesUrl: `${SITE}/changelog`,
  checkedAt: null,
  updatedTo: null,
  updatedNotesUrl: null,
};

function set(patch) {
  state = { ...state, ...patch };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("oovi:update", state);
  }
}

/** Error code for the page to translate: offline | damaged | failed. */
function friendly(err) {
  const msg = String((err && err.message) || err || "");
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::|getaddrinfo|network|fetch failed/i.test(msg)) return "offline";
  if (/sha512|checksum/i.test(msg)) return "damaged";
  return "failed";
}

function setupElectronUpdater() {
  const { autoUpdater } = require("electron-updater");
  autoUpdater.setFeedURL({ provider: "generic", url: FEED });
  autoUpdater.autoDownload = prefs.auto;
  // Only install when the user says so ("Restart now"), never silently on quit or shutdown.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;

  autoUpdater.on("update-available", (info) =>
    set({ status: autoUpdater.autoDownload ? "downloading" : "available", version: info.version, progress: 0, error: null, notesUrl: releaseUrl(info.version) }),
  );
  autoUpdater.on("update-not-available", () => set({ status: "none", version: null, error: null }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", progress: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (info) => {
    set({ status: "ready", version: info.version, progress: 100, error: null, notesUrl: releaseUrl(info.version) });
    if (installWhenReady) void install();
  });
  autoUpdater.on("error", (err) => {
    installWhenReady = false;
    installing = false;
    set({ status: "error", error: friendly(err) });
  });
  return autoUpdater;
}

/** Version check only (Mac, or a build that can't install itself): the version in the website's latest*.yml. */
async function checkLatestRelease() {
  const res = await fetch(`${FEED}/${process.platform === "darwin" ? "latest-mac.yml" : process.platform === "linux" ? "latest-linux.yml" : "latest.yml"}`, {
    headers: { "User-Agent": "oovi-desktop" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`The update server answered ${res.status}`);
  const latest = ((await res.text()).match(/^version:\s*["']?([\d.]+)/m) || [])[1] || "";
  if (latest && compare(latest, state.current) > 0) set({ status: "available", version: latest, error: null, notesUrl: releaseUrl(latest) });
  else set({ status: "none", version: null, error: null });
}

async function check() {
  if (fromStore) return state;
  if (checking || installing || state.status === "downloading" || state.status === "ready") return state;
  checking = true;
  set({ status: "checking", error: null });
  try {
    if (updater) await updater.checkForUpdates();
    else await checkLatestRelease();
  } catch (err) {
    set({ status: "error", error: friendly(err) });
  } finally {
    checking = false;
    set({ checkedAt: Date.now(), ...(state.status === "checking" ? { status: "none" } : {}) });
  }
  return state;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Close oovi, install the downloaded version and start it again.
 *
 * quitAndInstall(isSilent = false, isForceRunAfter = true) runs the one-click NSIS
 * installer with --updated: it skips every question, shows its own small progress
 * window while it replaces the app files, and starts oovi again when it's done
 * (nsis.runAfterFinish). App data is never touched.
 */
async function install() {
  if (!updater || installing) return;
  installing = true;
  installWhenReady = false;
  set({ status: "installing", error: null });
  rememberShortcuts();
  // Let the in-app "Updating... oovi will restart by itself" message be seen.
  await delay(1200);
  try {
    updater.quitAndInstall(false, true);
  } catch (err) {
    installing = false;
    set({ status: "error", error: friendly(err) });
  }
}

// ---------- shortcuts across updates ----------

/** Per-user desktop and Start-menu shortcuts made by the installer. */
function shortcutPaths() {
  return {
    desktop: path.join(app.getPath("desktop"), SHORTCUT),
    menu: path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", SHORTCUT),
  };
}

/** Before installing: note which shortcuts exist, so a missing one can be put back. */
function rememberShortcuts() {
  if (process.platform !== "win32") return;
  try {
    const p = shortcutPaths();
    prefs = { ...prefs, shortcuts: { desktop: fs.existsSync(p.desktop), menu: fs.existsSync(p.menu) } };
    savePrefs(prefs);
  } catch {
    /* not fatal */
  }
}

/** After an update: recreate a shortcut that existed before and is gone now. */
function restoreShortcuts() {
  const had = prefs.shortcuts;
  if (!had || process.platform !== "win32" || !app.isPackaged) return;
  const p = shortcutPaths();
  for (const key of ["desktop", "menu"]) {
    if (!had[key] || fs.existsSync(p[key])) continue;
    try {
      shell.writeShortcutLink(p[key], "create", { target: process.execPath, appUserModelId: APP_ID, description: "oovi" });
    } catch {
      /* not fatal */
    }
  }
}

/** The banner's main button: install (Windows) or open the download page (Mac). */
async function start() {
  if (!updater) {
    await shell.openExternal(downloadPage());
    return state;
  }
  if (installing) return state;
  if (state.status === "ready") {
    void install();
    return state;
  }
  installWhenReady = true;
  if (state.status === "available" || state.status === "error") {
    set({ status: "downloading", progress: 0, error: null });
    updater.downloadUpdate().catch((err) => {
      installWhenReady = false;
      set({ status: "error", error: friendly(err) });
    });
  }
  return state;
}

function setAuto(on) {
  prefs = { ...prefs, auto: !!on };
  savePrefs(prefs);
  set({ auto: prefs.auto });
  if (updater) {
    updater.autoDownload = prefs.auto;
    if (prefs.auto && state.status === "available") {
      set({ status: "downloading", progress: 0 });
      updater.downloadUpdate().catch((err) => set({ status: "error", error: friendly(err) }));
    }
  }
  return state;
}

/** isTrusted(event): only the app's own page may use these. */
function setupUpdates(isTrusted) {
  prefs = loadPrefs();
  state = { ...state, auto: prefs.auto };

  // Just restarted into a new version? The NSIS installer starts oovi with --updated
  // (electron-builder's StartApp macro); lastVersion covers every other way.
  const before = prefs.lastVersion;
  const updated = before ? compare(state.current, before) > 0 : process.argv.includes("--updated");
  if (updated) {
    state = { ...state, updatedTo: state.current, updatedNotesUrl: releaseUrl(state.current) };
    restoreShortcuts();
  }
  if (before !== state.current || prefs.shortcuts) {
    prefs = { ...prefs, lastVersion: state.current, shortcuts: null };
    savePrefs(prefs);
  }

  if (canSelfInstall) {
    try {
      updater = setupElectronUpdater();
    } catch {
      updater = null; // fall back to a version check + download page
      state = { ...state, canInstall: false };
    }
  }

  const handle = (channel, fn) => ipcMain.handle(channel, async (event, arg) => (isTrusted(event) ? fn(arg) : null));
  handle("oovi:update-get", () => state);
  handle("oovi:update-check", () => check());
  handle("oovi:update-start", () => start());
  handle("oovi:update-auto", (on) => setAuto(on === true));

  if (fromStore) return; // the Microsoft Store delivers updates
  setTimeout(() => void check(), FIRST_CHECK_MS);
  setInterval(() => void check(), CHECK_EVERY_MS).unref();
  const onReturn = () => {
    if (!state.checkedAt || Date.now() - state.checkedAt >= RECHECK_ON_RETURN_MS) void check();
  };
  app.on("browser-window-focus", onReturn);
  try {
    powerMonitor.on("resume", onReturn);
    powerMonitor.on("unlock-screen", onReturn);
  } catch {
    /* not on every system */
  }
}

module.exports = { setupUpdates, compare, _test: { check, getState: () => state } };
