import { test } from "node:test";
import assert from "node:assert/strict";
import { mayAct, pickWindow, windowLines, type AppWindow } from "../../lib/desktop-core.ts";

const w = (handle: number, title: string, exe: string, extra: Partial<AppWindow> = {}): AppWindow => ({ handle, title, className: "X", exe, own: false, elevated: false, ...extra });
const LIST: AppWindow[] = [
  w(1, "oovi", "oovi.exe", { own: true }),
  w(2, "Inbox - Gmail - Google Chrome", "chrome.exe"),
  w(3, "Facture.xlsx - Excel", "EXCEL.EXE", { minimized: true }),
  w(4, "Windows PowerShell", "powershell.exe"),
  w(5, "Bitwarden", "Bitwarden.exe"),
  w(6, "Nouvel onglet - Google Chrome", "chrome.exe"),
];

test("the list: oovi's own windows left out, private ones without their title, system ones marked", () => {
  const { lines } = windowLines(LIST);
  assert.deepEqual(lines, [
    "1. Inbox - Gmail - Google Chrome — chrome (in front)",
    "2. Facture.xlsx - Excel — EXCEL (minimized)",
    "3. Windows PowerShell — powershell (oovi doesn't act on this one: it can run programs or change the system)",
    "4. (a private window oovi doesn't touch)",
    "5. Nouvel onglet - Google Chrome — chrome",
  ]);
});

test("a window is chosen by number or by words of its title or app", () => {
  assert.equal((pickWindow(LIST, "2") as { win: AppWindow }).win.handle, 3);
  assert.equal((pickWindow(LIST, "excel") as { win: AppWindow }).win.handle, 3);
  assert.equal((pickWindow(LIST, "gmail") as { win: AppWindow }).win.handle, 2);
  // Two windows of the same app: the one nearest the front.
  assert.equal((pickWindow(LIST, "chrome") as { win: AppWindow }).win.handle, 2);
  assert.match((pickWindow(LIST, "9") as { error: string }).error, /There is no window 9: the list has 5/);
  assert.match((pickWindow(LIST, "word") as { error: string }).error, /No open window matches "word"/);
  assert.match((pickWindow(LIST, "") as { error: string }).error, /Say which window/);
});

test("oovi never acts on its own, system or private windows", () => {
  assert.equal(mayAct(LIST[1]!), null);
  assert.ok(mayAct(LIST[0]!));
  assert.ok(mayAct(LIST[3]!));
  assert.ok(mayAct(LIST[4]!));
  assert.ok(mayAct(w(9, "Admin tool", "tool.exe", { elevated: true })));
});
