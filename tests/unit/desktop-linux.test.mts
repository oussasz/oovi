import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { blockedApp, findApp, type AppEntry } from "../../lib/desktop-apps-core.ts";
import { forbiddenCombo, windowVerdict, maskedWindow } from "../../lib/desktop-core.ts";

const require = createRequire(import.meta.url);
const { parseDesktopEntry, execArgs } = require("../../electron/linux-apps.cjs");

const win = (o: Record<string, unknown>) => ({ handle: 1, title: "", className: "", exe: "", own: false, elevated: false, ...o }) as never;

test("Linux: terminals, settings, system tools and launchers are refused", () => {
  for (const [exe, cls] of [["gnome-terminal-server", "Gnome-terminal"], ["konsole", "konsole"], ["kitty", "kitty"], ["python3", "Software-properties-gtk"], ["gnome-control-center", "Gnome-control-center"], ["plasmashell", "plasmashell"], ["xterm", "XTerm"]]) {
    assert.equal(windowVerdict(win({ exe, className: cls, title: "x" }))?.reason, "system", `${exe}/${cls}`);
  }
});

test("Linux: password managers and admin prompts are protected and blacked out", () => {
  for (const exe of ["keepassxc", "bitwarden", "seahorse"]) {
    const w = win({ exe, title: "My vault" });
    assert.equal(windowVerdict(w)?.reason, "password");
    assert.equal(maskedWindow(w), true);
  }
  assert.equal(windowVerdict(win({ exe: "polkit-gnome-authentication-agent-1", title: "x" }))?.reason, "security");
  assert.equal(windowVerdict(win({ exe: "gcr-prompter", title: "x" }))?.reason, "security");
  assert.equal(windowVerdict(win({ exe: "firefox", title: "Authentication Required" }))?.reason, "security");
  assert.ok(windowVerdict(win({ exe: "synaptic", elevated: true, title: "Synaptic" })), "a root window is refused");
  assert.equal(windowVerdict(win({ exe: "gedit", elevated: true, title: "notes" }))?.reason, "elevated");
});

test("Linux: ordinary apps are allowed", () => {
  for (const [exe, cls, title] of [["firefox", "firefox", "oovi — Mozilla Firefox"], ["nautilus", "org.gnome.Nautilus", "Downloads"], ["libreoffice", "libreoffice-writer", "Report.odt"], ["chrome", "Google-chrome", "Inbox"]]) {
    assert.equal(windowVerdict(win({ exe, className: cls, title })), null, exe);
  }
});

test("Linux keys that open a terminal, a Run box or leave the desktop are blocked", () => {
  assert.match(forbiddenCombo({ key: "f2", modifiers: ["alt"] }) ?? "", /Alt\+F2/);
  assert.match(forbiddenCombo({ key: "t", modifiers: ["control", "alt"] }) ?? "", /terminal/);
  assert.ok(forbiddenCombo({ key: "f3", modifiers: ["control", "alt"] }));
  assert.ok(forbiddenCombo({ key: "command", modifiers: [] }));
  assert.equal(forbiddenCombo({ key: "t", modifiers: ["control"] }), null, "Ctrl+T (new tab) still works");
});

test("Linux apps menu: entries are read, field codes dropped, quotes kept", () => {
  const e = parseDesktopEntry("[Desktop Entry]\nName=Firefox\nName[fr]=Firefox FR\nExec=firefox %u\nType=Application\n\n[Desktop Action new]\nName=New window\nExec=firefox --new-window");
  assert.deepEqual([e.Name, e.Exec, e.Type], ["Firefox", "firefox %u", "Application"]);
  assert.deepEqual(execArgs('"/opt/My App/app" --flag %F'), ["/opt/My App/app", "--flag"]);
  assert.deepEqual(execArgs("env FOO=1 code %F"), ["env", "FOO=1", "code"]);
});

test("Linux apps: terminals and system tools can't be opened; normal apps can", () => {
  const apps: AppEntry[] = [
    { name: "Terminal", path: "/usr/share/applications/org.gnome.Terminal.desktop", target: "gnome-terminal", desktop: true },
    { name: "Software & Updates", path: "/usr/share/applications/software-properties-gtk.desktop", target: "software-properties-gtk", desktop: true },
    { name: "Firefox", path: "/usr/share/applications/firefox.desktop", target: "firefox", desktop: true },
    { name: "LibreOffice Writer", path: "/usr/share/applications/libreoffice-writer.desktop", target: "libreoffice", desktop: true },
    { name: "Backup script", path: "/home/u/.local/share/applications/b.desktop", target: "backup.sh", desktop: true },
  ];
  assert.ok(blockedApp(apps[0]!));
  assert.ok(blockedApp(apps[1]!));
  assert.equal(blockedApp(apps[2]!), null);
  assert.ok(blockedApp(apps[4]!), "scripts are not apps");
  const f = findApp(apps, "writer");
  assert.ok("app" in f && f.app.name === "LibreOffice Writer");
  assert.match(("error" in findApp(apps, "terminal") ? (findApp(apps, "terminal") as { error: string }).error : ""), /doesn't let bots open/);
});
