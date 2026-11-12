// Choosing which installed app a bot may open (the open_app tool), from the Start menu's shortcuts.
// The bot can't use Start, Run, Search or the taskbar (they can launch anything); this opens ONE app,
// by name, after the user's OK on a card. Programs that run commands or change the system are never
// offered: terminals, PowerShell, Registry Editor, Settings, Task Manager, installers, uninstallers,
// password managers.
// Pure (no imports): tests/unit/desktop-apps.test.mts.

/** store: a Microsoft Store app (path "shell:AppsFolder\\<package id>!<app>", no shortcut file). */
export type AppEntry = { name: string; path: string; target?: string; store?: boolean };

/** Store packages that run commands or change the system (Terminal, PowerShell, Settings, the Store itself, Dev Home…). */
const BLOCKED_PACKAGE = /WindowsTerminal|PowerShell|immersivecontrolpanel|Microsoft\.WindowsStore|Microsoft\.DevHome|Microsoft\.WinGet|DesktopAppInstaller|Microsoft\.SecHealthUI|Microsoft\.Windows\.SecHealthUI|Microsoft\.Windows\.Shell|Microsoft\.Windows\.Search|windows\.immersive|MicrosoftCorporationII\.QuickAssist|Microsoft\.RemoteDesktop|WindowsSubsystemForLinux|CanonicalGroupLimited|TheDebianProject|SUSE|KaliLinux|AutoHotkey|1Password|Bitwarden|KeePass|LastPass|Dashlane|NordPass|Keeper/i;

const BLOCKED_EXE = new Set([
  "cmd.exe", "powershell.exe", "powershell_ise.exe", "pwsh.exe", "windowsterminal.exe", "wt.exe", "openconsole.exe", "conhost.exe",
  "bash.exe", "wsl.exe", "wslhost.exe", "mintty.exe", "git-bash.exe", "git-cmd.exe", "regedit.exe", "regedt32.exe", "taskmgr.exe", "mmc.exe",
  "systemsettings.exe", "msiexec.exe", "control.exe", "rundll32.exe", "wscript.exe", "cscript.exe", "mshta.exe", "msconfig.exe",
  "perfmon.exe", "resmon.exe", "eventvwr.exe", "netplwiz.exe", "quickassist.exe", "mstsc.exe", "msra.exe", "dfrgui.exe", "cleanmgr.exe",
  "diskpart.exe", "compmgmt.msc", "services.msc", "gpedit.msc", "taskschd.msc", "devmgmt.msc", "diskmgmt.msc", "explorer.exe",
  "1password.exe", "bitwarden.exe", "keepass.exe", "keepassxc.exe", "lastpass.exe", "dashlane.exe", "keeper.exe", "nordpass.exe", "enpass.exe", "roboform.exe",
]);
const BLOCKED_NAME =
  /uninstall|désinstall|deinstall|desinstal|kaldır|إلغاء التثبيت|\bsetup\b|\binstaller?\b|\brepair\b|\bupdater?\b|command prompt|invite de commandes|eingabeaufforderung|símbolo del sistema|komut istemi|powershell|terminal|\bconsole\b|git (bash|cmd)|registry|registre|task manager|gestionnaire des tâches|task scheduler|control panel|panneau de configuration|^settings$|^paramètres$|^run$|^exécuter$|administrative|computer management|services|event viewer|remote desktop|bureau à distance|1password|bitwarden|keepass|lastpass|dashlane|nordpass|enpass|roboform|keeper|^oovi$/i;

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const exeOf = (target?: string) => (target ?? "").replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";

/** Why this app can't be opened by a bot, or null when it can. */
export function blockedApp(a: AppEntry): string | null {
  if (a.store) {
    if (!/^shell:AppsFolder\\[\w.\-]+![\w.\-]+$/.test(a.path)) return "It isn't a program";
    if (BLOCKED_PACKAGE.test(a.path) || BLOCKED_NAME.test(a.name)) return "It can run commands, change the system or holds passwords";
    return null;
  }
  const exe = exeOf(a.target);
  if (BLOCKED_EXE.has(exe) || /\.(msc|bat|cmd|ps1|vbs|js|reg|scr|hta|msi)$/i.test(a.target ?? "")) return "It can run commands or change the system";
  if (BLOCKED_NAME.test(a.name)) return "It can run commands, change the system or holds passwords";
  // A shortcut without a known program behind it (a web link, a document, a script): not an app to start.
  if (a.target !== undefined && a.target !== "" && !/\.exe$/i.test(a.target)) return "It isn't a program";
  return null;
}

export type AppMatch = { app: AppEntry } | { error: string };

/**
 * The installed app this name means. Exact name first, then names that start with it, then names
 * that contain every word. Two different apps that fit equally well: the bot must say which.
 */
export function findApp(apps: AppEntry[], wanted: string): AppMatch {
  const q = norm(String(wanted ?? ""));
  if (!q || q.length > 80) return { error: "Give the app's name, for example \"Excel\" or \"Google Chrome\"." };
  const scored = apps
    .map((a) => {
      const n = norm(a.name);
      const words = q.split(" ");
      const score = n === q ? 3 : n.startsWith(`${q} `) || n.endsWith(` ${q}`) ? 2 : words.every((w) => n.split(" ").includes(w)) ? 1 : 0;
      return { a, n, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.n.length - y.n.length);
  if (!scored.length) return { error: `No installed app is called "${wanted}" (Start menu and Microsoft Store apps were searched; the Store list is read a few seconds after oovi starts). Check the name, or the app may not be installed: if the user wants it opened anyway, take a screenshot and open it from a shortcut you see on the desktop or in an open window.` };
  const best = scored.filter((x) => x.score === scored[0]!.score);
  // The same app listed twice (for this user and for all users) is one app.
  const names = [...new Set(best.map((x) => x.n))];
  if (names.length > 1 && scored[0]!.score < 3) return { error: `Several apps match "${wanted}": ${best.slice(0, 6).map((x) => x.a.name).join(", ")}. Call open_app again with the exact name.` };
  const app = best[0]!.a;
  const why = blockedApp(app);
  if (why) return { error: `oovi doesn't let bots open "${app.name}": ${why.toLowerCase()}. Ask the user to do this part.` };
  return { app };
}
