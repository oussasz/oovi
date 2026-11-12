// Runs on a real Windows machine (GitHub's windows-latest, .github/workflows/windows-check.yml):
// the native half of manage_window and of Store apps, which no other test can reach.
// Opens Notepad, finds it in the window list, minimizes it, brings it back to the front, maximizes
// it, closes it; then reads the Store apps list the way the app does.
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const koffi = require(process.env.KOFFI_PATH || "koffi");
const win32 = require(path.join(__dirname, "../../electron/win32-windows.cjs")).load(koffi);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const findPad = () => win32.appWindows().find((w) => /notepad/i.test(w.exe) || /notepad|bloc-notes/i.test(w.title));

(async () => {
  const before = win32.appWindows();
  console.log(`windows before: ${before.length}: ${before.map((w) => `${w.title} [${w.exe}]`).join(" | ").slice(0, 600)}`);
  const pad = spawn("notepad.exe", [], { detached: true, stdio: "ignore" });
  pad.unref();
  let w = null;
  for (let i = 0; i < 40 && !w; i++) {
    await sleep(500);
    w = findPad();
  }
  check("Notepad appears in the list of windows the user can switch to, with its title and program", !!w, w ? `${w.title} [${w.exe}] handle ${w.handle}` : "not found");
  if (!w) return finish();

  check("minimize", win32.act(w.handle, "minimize") === "");
  await sleep(700);
  check("...the list says it is minimized", findPad()?.minimized === true, JSON.stringify(findPad()?.minimized));

  const sw = win32.act(w.handle, "switch");
  await sleep(700);
  const fg = win32.foreground();
  check("switch brings it back and puts it in front (it gets the keyboard)", sw === "" && findPad()?.minimized === false && fg?.handle === w.handle, `act: "${sw}"; foreground: ${fg?.title}`);

  check("maximize", win32.act(w.handle, "maximize") === "");
  await sleep(700);
  check("...the list says it is maximized", findPad()?.maximized === true);

  check("a handle that isn't an open window is refused", win32.act(123456789, "close") === "That window isn't open any more.");

  check("close", win32.act(w.handle, "close") === "");
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) {
    await sleep(300);
    gone = !findPad();
  }
  check("...Notepad has closed (nothing unsaved, so it asked nothing)", gone);

  // Store apps, read exactly as the app reads them.
  try {
    const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const out = execFileSync(ps, ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Where-Object { $_.AppID -like '*!*' } | ConvertTo-Json -Compress"], { encoding: "utf8", timeout: 60_000 });
    const j = JSON.parse(out || "[]");
    const rows = (Array.isArray(j) ? j : [j]).filter((r) => r && r.Name && /^[\w.\-]+!\w[\w.\-]*$/.test(r.AppID));
    console.log(`store apps: ${rows.length}: ${rows.slice(0, 12).map((r) => `${r.Name} (${r.AppID})`).join(" | ")}`);
    check("the Store apps list can be read (packaged apps with their ids)", rows.length > 0);
  } catch (e) {
    check("the Store apps list can be read", false, String(e).slice(0, 200));
  }
  finish();
})().catch((e) => {
  console.log("ERROR", e && e.stack);
  process.exit(2);
});

function finish() {
  const ok = results.filter(Boolean).length;
  console.log(`${ok}/${results.length} checks passed`);
  process.exit(ok === results.length ? 0 : 1);
}
