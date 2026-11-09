// App updates.
//
// New versions are published to the public repo oussasz/oovi-downloads.
// - Windows (installed app): electron-updater downloads the new installer, checks
//   its SHA-512 against latest.yml and installs it over the old version. The
//   user's data lives in the app-data folder, which the installer never touches.
// - Mac, and any build that can't self-install: we only check the version and
//   send the user to the download page (Mac apps must be code-signed to update
//   themselves).
//
// "Install updates automatically" (on by default) downloads in the background and
// installs when oovi quits; the banner offers "Restart now" as soon as it's ready.

const { app, ipcMain, shell, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const OWNER = "oussasz";
const REPO = "oovi-downloads";
const SITE = "https://oovi.vercel.app";
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// Installed from the Microsoft Store: the Store updates the app, so oovi doesn't.
const fromStore = !!process.windowsStore;
const canSelfInstall = process.platform === "win32" && app.isPackaged && !fromStore;
const prefsFile = () => path.join(app.getPath("userData"), "update.json");

function loadPrefs() {
  try {
    const j = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
    return { auto: j.auto !== false };
  } catch {
    return { auto: true };
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

const downloadPage = () =>
  `${SITE}/download/${process.platform === "darwin" ? (process.arch === "arm64" ? "mac-arm64" : "mac-intel") : "windows"}`;

let prefs = { auto: true };
let updater = null; // electron-updater's autoUpdater (Windows only)
let installWhenReady = false;
let checking = false;

/**
 * status: idle | checking | none | available | downloading | ready | error
 * canInstall: oovi can install it itself (Windows); otherwise "Download" opens the website.
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
  notesUrl: `https://github.com/${OWNER}/${REPO}/releases/latest`,
  checkedAt: null,
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
  autoUpdater.setFeedURL({ provider: "github", owner: OWNER, repo: REPO });
  autoUpdater.autoDownload = prefs.auto;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;

  autoUpdater.on("update-available", (info) => set({ status: autoUpdater.autoDownload ? "downloading" : "available", version: info.version, progress: 0, error: null }));
  autoUpdater.on("update-not-available", () => set({ status: "none", version: null, error: null }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", progress: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (info) => {
    set({ status: "ready", version: info.version, progress: 100, error: null });
    if (installWhenReady) install();
  });
  autoUpdater.on("error", (err) => {
    installWhenReady = false;
    set({ status: "error", error: friendly(err) });
  });
  return autoUpdater;
}

/** Version check only (Mac, or a build that can't install itself). */
async function checkLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "oovi-desktop" },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const j = await res.json();
  const latest = String(j.tag_name || "").replace(/^v/, "");
  if (latest && compare(latest, state.current) > 0) set({ status: "available", version: latest, error: null });
  else set({ status: "none", version: null, error: null });
}

async function check() {
  if (fromStore) return state;
  if (checking || state.status === "downloading" || state.status === "ready") return state;
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

function install() {
  if (!updater) return;
  // Silent install over the current version, then start the new one.
  // Data in the app-data folder is left as it is.
  setImmediate(() => updater.quitAndInstall(true, true));
}

/** The banner's main button: install (Windows) or open the download page (Mac). */
async function start() {
  if (!updater) {
    await shell.openExternal(downloadPage());
    return state;
  }
  if (state.status === "ready") {
    install();
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
  prefs = { auto: !!on };
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
}

module.exports = { setupUpdates, compare, _test: { check, getState: () => state } };
