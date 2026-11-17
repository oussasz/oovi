// Installed apps on Linux, for open_app: the applications menu's entries (.desktop files), the way the
// Start menu's shortcuts are on Windows. System, user, Flatpak and Snap apps. An entry that runs in a
// terminal, is hidden from the menu or isn't an application is left out; lib/desktop-apps-core.ts then
// refuses terminals, settings, system tools and password managers. Started with `gio launch` (as the
// menu does), else the entry's own command line, never through a shell.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

function dirs() {
  const home = os.homedir();
  const data = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return [
    path.join(process.env.XDG_DATA_HOME || path.join(home, ".local/share"), "applications"),
    ...data.map((d) => path.join(d, "applications")),
    "/var/lib/flatpak/exports/share/applications",
    path.join(home, ".local/share/flatpak/exports/share/applications"),
    "/var/lib/snapd/desktop/applications",
  ];
}

/** The [Desktop Entry] group of a .desktop file: { Name, Exec, … } (only the main group, no translations). */
function parseDesktopEntry(text) {
  const out = {};
  let inMain = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inMain = line === "[Desktop Entry]";
      continue;
    }
    if (!inMain) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    if (key.includes("[")) continue;
    out[key] = line.slice(i + 1).trim();
  }
  return out;
}

/** The program and arguments of an Exec line, without the %f/%u… field codes (spec: quoted args, \\ escapes). */
function execArgs(exec) {
  const args = [];
  let cur = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i];
    if (quoted) {
      if (c === "\\" && i + 1 < exec.length) cur += exec[++i];
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') {
      quoted = true;
      started = true;
    } else if (c === " " || c === "\t") {
      if (started) args.push(cur);
      cur = "";
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (started) args.push(cur);
  return args.filter((a) => !/^%[a-zA-Z]$/.test(a)).map((a) => a.replace(/%%/g, "%"));
}

/** { name, path, target, desktop: true } for each app the menu shows; the first entry of an id wins (user over system). */
function linuxApps() {
  const seen = new Set();
  const out = [];
  for (const dir of dirs()) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".desktop"));
    } catch {
      continue;
    }
    for (const f of files) {
      if (seen.has(f)) continue;
      seen.add(f);
      const file = path.join(dir, f);
      let e;
      try {
        e = parseDesktopEntry(fs.readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      if (e.Type !== "Application" || !e.Name || !e.Exec || e.NoDisplay === "true" || e.Hidden === "true" || e.Terminal === "true") continue;
      const [prog = ""] = execArgs(e.Exec);
      // Flatpak and env wrappers: the real program is further along ("flatpak run org.gimp.GIMP", "env X=1 app").
      const args = execArgs(e.Exec);
      const real = prog.endsWith("flatpak") ? args[args.indexOf("run") + 1] || prog : path.basename(prog) === "env" ? args.find((a, i) => i > 0 && !a.includes("=")) || prog : prog;
      out.push({ name: e.Name, path: file, target: path.basename(real), desktop: true });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

let gio = null;
const hasGio = () => {
  if (gio === null) {
    try {
      execFileSync("gio", ["version"], { stdio: "ignore", timeout: 3000 });
      gio = true;
    } catch {
      gio = false;
    }
  }
  return gio;
};

/** Starts one listed app (the caller checked it is in the list). Resolves "" or an error text. */
function launch(file) {
  return new Promise((resolve) => {
    let cmd;
    let args;
    if (hasGio()) {
      cmd = "gio";
      args = ["launch", file];
    } else {
      try {
        const e = parseDesktopEntry(fs.readFileSync(file, "utf8"));
        [cmd, ...args] = execArgs(e.Exec || "");
      } catch (err) {
        return resolve(String((err && err.message) || err));
      }
      if (!cmd) return resolve("That app has no command to start it.");
    }
    const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
    p.once("error", (err) => resolve(String((err && err.message) || err)));
    p.once("spawn", () => {
      p.unref();
      resolve("");
    });
  });
}

module.exports = { linuxApps, launch, parseDesktopEntry, execArgs };
