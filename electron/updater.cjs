// App updates.
//
// New versions are published to the public repo oussasz/oovi-downloads.
// - Windows (installed app): electron-updater downloads the new installer, checks
//   its SHA-512 against latest.yml and installs it over the old version. The
//   user's data lives in the app-data folder, which the installer never touches.
// - Mac, and any build that can't self-install: we only check the version and
//   send the user to the download page (Mac apps must be code-signed to update
//   themselves).
// - Microsoft Store builds: the Store updates the app; oovi does nothing.
//
// "Install updates automatically" (on by default) downloads in the background and
// installs when oovi quits; the banner offers "Restart now" as soon as it's ready.
//
// "Update now" / "Restart now" on Windows:
//   1. The page switches to "Updating oovi to X... oovi will restart by itself".
//   2. A small progress window (PowerShell + WinForms, built into Windows) opens and
//      stays up while oovi closes and the new version installs; it closes itself
//      once the new oovi is running.
//   3. electron-updater runs the NSIS installer silently (/S) with --updated and
//      --force-run, so the installer starts oovi again when it's done.
//   4. On the next start oovi says "oovi was updated to X" once, and puts back a
//      desktop / Start-menu shortcut that existed before the update if it went missing.

const { app, ipcMain, shell, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OWNER = "oussasz";
const REPO = "oovi-downloads";
const SITE = "https://oovi.conuron.com";
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const APP_ID = "app.oovi.desktop"; // package.json build.appId (the shortcuts' AppUserModelID)
const SHORTCUT = "oovi.lnk"; // package.json build.nsis.shortcutName
const releaseUrl = (v) => `https://github.com/${OWNER}/${REPO}/releases/tag/v${String(v).replace(/^v/, "")}`;

// Installed from the Microsoft Store: the Store updates the app, so oovi doesn't.
const fromStore = !!process.windowsStore;
const canSelfInstall = process.platform === "win32" && app.isPackaged && !fromStore;
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

const downloadPage = () =>
  `${SITE}/download/${process.platform === "darwin" ? (process.arch === "arm64" ? "mac-arm64" : "mac-intel") : "windows"}`;

let prefs = { auto: true, lastVersion: null, shortcuts: null };
let updater = null; // electron-updater's autoUpdater (Windows only)
let installWhenReady = false;
let installing = false;
let checking = false;
let progressCancel = null; // file that tells the small "Updating oovi" window to close

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
  notesUrl: `https://github.com/${OWNER}/${REPO}/releases/latest`,
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
  autoUpdater.setFeedURL({ provider: "github", owner: OWNER, repo: REPO });
  autoUpdater.autoDownload = prefs.auto;
  autoUpdater.autoInstallOnAppQuit = true;
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
    closeProgressWindow();
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
 * quitAndInstall(isSilent = true, isForceRunAfter = true) runs the NSIS installer with
 * `--updated /S --force-run`. The installer is "assisted" (nsis.oneClick: false), so a
 * non-silent run would show the whole wizard (the "install for whom" page, then a
 * Finish page the user has to click), and electron-updater ignores isForceRunAfter
 * when isSilent is false. Silent + force-run is the only mode that installs without
 * questions and restarts oovi by itself, so the visible progress comes from our own
 * small window. App data is never touched.
 */
async function install() {
  if (!updater || installing) return;
  installing = true;
  installWhenReady = false;
  set({ status: "installing", error: null });
  rememberShortcuts();
  let shown = false;
  try {
    shown = await openProgressWindow(state.version);
  } catch {
    /* no progress window: the in-app message still says what happens */
  }
  // Let the in-app "Updating... oovi will restart by itself" message be seen.
  await delay(shown ? 700 : 1800);
  try {
    updater.quitAndInstall(true, true);
  } catch (err) {
    installing = false;
    closeProgressWindow();
    set({ status: "error", error: friendly(err) });
  }
}

// ---------- the small "Updating oovi" window ----------

// Window text in the UI language (the main process has no i18n of its own).
const WINDOW_TEXT = {
  en: { text: "Updating oovi to {v}…", sub: "oovi will restart by itself. Your chats and settings are kept.", slow: "This is taking longer than usual. If oovi doesn't open, start it from the Start menu." },
  fr: { text: "Mise à jour d'oovi vers {v}…", sub: "oovi va redémarrer tout seul. Vos discussions et réglages sont conservés.", slow: "C'est plus long que d'habitude. Si oovi ne s'ouvre pas, lancez-le depuis le menu Démarrer." },
  ar: { text: "جارٍ تحديث oovi إلى {v}…", sub: "سيُعاد تشغيل oovi تلقائيًا. محادثاتك وإعداداتك محفوظة.", slow: "يستغرق هذا وقتًا أطول من المعتاد. إذا لم يُفتح oovi، شغّله من قائمة ابدأ." },
  es: { text: "Actualizando oovi a {v}…", sub: "oovi se reiniciará solo. Tus chats y ajustes se conservan.", slow: "Está tardando más de lo normal. Si oovi no se abre, inícialo desde el menú Inicio." },
  de: { text: "oovi wird auf {v} aktualisiert…", sub: "oovi startet von selbst neu. Deine Chats und Einstellungen bleiben erhalten.", slow: "Das dauert länger als üblich. Wenn oovi nicht startet, öffne es über das Startmenü." },
  tr: { text: "oovi {v} sürümüne güncelleniyor…", sub: "oovi kendiliğinden yeniden başlayacak. Sohbetlerin ve ayarların korunur.", slow: "Bu, her zamankinden uzun sürüyor. oovi açılmazsa Başlat menüsünden başlat." },
};

/** The UI language the user picked in oovi (falls back to the system language). */
async function uiLanguage() {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
  try {
    if (w) {
      const l = await w.webContents.executeJavaScript(
        `(() => { try { const s = localStorage.getItem("oovi.language"); return s && s !== "auto" ? s : navigator.language; } catch { return navigator.language; } })()`,
        false,
      );
      return String(l || "").slice(0, 2).toLowerCase();
    }
  } catch {
    /* page busy or gone */
  }
  return String(app.getLocale() || "en").slice(0, 2).toLowerCase();
}

// A small always-on-top window with a moving progress bar. It waits for this oovi
// process to exit, then for a NEW oovi process (started by the installer), and
// closes 2 s later. Gives up after 5 minutes. All text comes in via env vars.
//
// Two stages: oovi starts stage 1 as a normal child (PowerShell exits at once when
// started DETACHED, it needs a console), and stage 1 starts stage 2 with
// CREATE_NO_WINDOW. Stage 2 is a grandchild, so it isn't in the job that Node/libuv
// uses to kill oovi's children when oovi exits (that job allows silent breakaway),
// and it keeps running while oovi is closed and updated.
const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
if ($env:OOVI_UPD_STAGE -ne '2') {
  $env:OOVI_UPD_STAGE = '2'
  $si = New-Object System.Diagnostics.ProcessStartInfo
  $si.FileName = Join-Path $PSHOME 'powershell.exe'
  $si.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File "' + $PSCommandPath + '"'
  $si.UseShellExecute = $false
  $si.CreateNoWindow = $true
  [void][System.Diagnostics.Process]::Start($si)
  exit
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$exe = $env:OOVI_UPD_EXE
$name = [System.IO.Path]::GetFileNameWithoutExtension($exe)
$oldPid = [int]$env:OOVI_UPD_PID
$started = Get-Date
$state = @{ phase = 0; gone = $null; seen = $null }

$f = New-Object System.Windows.Forms.Form
$f.Text = 'oovi'
$f.FormBorderStyle = 'FixedSingle'
$f.MaximizeBox = $false
$f.StartPosition = 'CenterScreen'
$f.ClientSize = New-Object System.Drawing.Size(400, 124)
$f.TopMost = $true
$f.BackColor = [System.Drawing.Color]::FromArgb(251, 250, 247)
if ($env:OOVI_UPD_RTL -eq '1') { $f.RightToLeft = 'Yes'; $f.RightToLeftLayout = $true }
try { $f.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe) } catch {}

$l1 = New-Object System.Windows.Forms.Label
$l1.Text = $env:OOVI_UPD_TEXT
$l1.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$l1.ForeColor = [System.Drawing.Color]::FromArgb(23, 23, 23)
$l1.SetBounds(20, 16, 360, 26)
$l2 = New-Object System.Windows.Forms.Label
$l2.Text = $env:OOVI_UPD_SUB
$l2.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$l2.ForeColor = [System.Drawing.Color]::FromArgb(116, 115, 108)
$l2.SetBounds(20, 44, 360, 38)
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Style = 'Marquee'
$bar.MarqueeAnimationSpeed = 25
$bar.SetBounds(20, 92, 360, 12)
$f.Controls.AddRange(@($l1, $l2, $bar))

$t = New-Object System.Windows.Forms.Timer
$t.Interval = 400
$t.Add_Tick({
  $now = Get-Date
  if ($state.phase -eq 0) {
    if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) { $state.phase = 1; $state.gone = $now }
  } elseif ($state.phase -eq 1) {
    $new = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt $state.gone }
    if ($new) { $state.phase = 2; $state.seen = $now }
  } elseif (($now - $state.seen).TotalSeconds -gt 2) { $t.Stop(); $f.Close() }
  if ($state.phase -lt 2 -and ($now - $started).TotalSeconds -gt 90) { $l2.Text = $env:OOVI_UPD_SLOW }
  if (($now - $started).TotalMinutes -gt 5 -or (Test-Path -LiteralPath $env:OOVI_UPD_CANCEL)) { $t.Stop(); $f.Close() }
})
$f.Add_Shown({
  $f.Activate()
  $t.Start()
  try { [System.IO.File]::WriteAllText($env:OOVI_UPD_READY, [string]$f.Visible) } catch {}
})
[System.Windows.Forms.Application]::Run($f)
Remove-Item -LiteralPath $PSCommandPath, $env:OOVI_UPD_CANCEL -Force -ErrorAction SilentlyContinue
`;

/** Opens the progress window. Resolves true once it's on screen (false after 5 s). */
async function openProgressWindow(version, opts = {}) {
  if (process.platform !== "win32") return false;
  const lang = await uiLanguage();
  const w = WINDOW_TEXT[lang] || WINDOW_TEXT.en;
  const stamp = `${process.pid}-${Date.now()}`;
  const script = path.join(os.tmpdir(), `oovi-update-${stamp}.ps1`);
  const ready = path.join(os.tmpdir(), `oovi-update-${stamp}.ready`);
  progressCancel = path.join(os.tmpdir(), `oovi-update-${stamp}.cancel`);
  // UTF-8 with BOM, so Windows PowerShell 5.1 reads the script as UTF-8.
  fs.writeFileSync(script, `\ufeff${PS_SCRIPT}`, "utf8");
  const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const child = spawn(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      OOVI_UPD_EXE: opts.exe || process.execPath,
      OOVI_UPD_PID: String(opts.pid || process.pid),
      OOVI_UPD_READY: ready,
      OOVI_UPD_CANCEL: progressCancel,
      OOVI_UPD_RTL: lang === "ar" ? "1" : "0",
      OOVI_UPD_TEXT: w.text.replace("{v}", version || ""),
      OOVI_UPD_SUB: w.sub,
      OOVI_UPD_SLOW: w.slow,
    },
  });
  let failed = false;
  child.on("error", () => {
    failed = true;
  });
  child.unref();
  for (let i = 0; i < 50 && !failed; i++) {
    if (fs.existsSync(ready)) {
      const visible = fs.readFileSync(ready, "utf8").trim() === "True";
      fs.rm(ready, { force: true }, () => {});
      return visible;
    }
    await delay(100);
  }
  return false;
}

/** The install didn't start: close the progress window (it checks for this file). */
function closeProgressWindow() {
  if (!progressCancel) return;
  try {
    fs.writeFileSync(progressCancel, "cancel");
  } catch {
    /* not fatal: the window gives up after 5 minutes anyway */
  }
  progressCancel = null;
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
}

module.exports = { setupUpdates, compare, _test: { check, getState: () => state, openProgressWindow } };
