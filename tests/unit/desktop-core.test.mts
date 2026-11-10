import { test } from "node:test";
import assert from "node:assert/strict";
import * as c from "../../lib/desktop-core.ts";

test("screen size from DIPs and Windows scale factors", () => {
  assert.deepEqual(c.realScreen({ width: 1920, height: 1080 }, 1), { width: 1920, height: 1080 });
  assert.deepEqual(c.realScreen({ width: 1536, height: 864 }, 1.25), { width: 1920, height: 1080 });
  assert.deepEqual(c.realScreen({ width: 1280, height: 720 }, 1.5), { width: 1920, height: 1080 });
  assert.deepEqual(c.realScreen({ width: 1707, height: 1067 }, 1.5), { width: 2561, height: 1601 });
  // The input library's own size wins (that's where the mouse moves).
  assert.deepEqual(c.realScreen({ width: 1707, height: 1067 }, 1.5, { width: 2560, height: 1600 }), { width: 2560, height: 1600 });
  assert.deepEqual(c.realScreen({ width: 1920, height: 1080 }, 0), { width: 1920, height: 1080 });
});

test("screenshots fit 1280x720 with the aspect ratio, never upscale", () => {
  assert.deepEqual(c.fitWithin({ width: 1920, height: 1080 }), { width: 1280, height: 720 });
  assert.deepEqual(c.fitWithin({ width: 1920, height: 1200 }), { width: 1152, height: 720 });
  assert.deepEqual(c.fitWithin({ width: 2560, height: 1600 }), { width: 1152, height: 720 });
  assert.deepEqual(c.fitWithin({ width: 3440, height: 1440 }), { width: 1280, height: 536 });
  assert.deepEqual(c.fitWithin({ width: 1024, height: 768 }), { width: 960, height: 720 });
  assert.deepEqual(c.fitWithin({ width: 1280, height: 720 }), { width: 1280, height: 720 });
  assert.deepEqual(c.fitWithin({ width: 800, height: 600 }), { width: 800, height: 600 });
});

test("screenshot coordinates map to the real screen at 100%, 125% and 150%", () => {
  for (const [dip, k] of [[{ width: 1920, height: 1080 }, 1], [{ width: 1536, height: 864 }, 1.25], [{ width: 1280, height: 720 }, 1.5], [{ width: 2048, height: 1280 }, 1.25]] as const) {
    const real = c.realScreen(dip, k);
    const shot = c.fitWithin(real);
    // Each screenshot pixel maps to the middle of the real pixels it covers.
    const tl = c.shotToReal({ x: 0, y: 0 }, shot, real);
    assert.ok(tl.x <= 1 && tl.y <= 1, `${k}: top-left ${JSON.stringify(tl)}`);
    const br = c.shotToReal({ x: shot.width - 1, y: shot.height - 1 }, shot, real);
    assert.ok(br.x >= real.width - 2 && br.x <= real.width - 1 && br.y >= real.height - 2 && br.y <= real.height - 1, `${k}: bottom-right ${JSON.stringify(br)}`);
    const mid = c.shotToReal({ x: shot.width / 2, y: shot.height / 2 }, shot, real);
    assert.ok(Math.abs(mid.x - real.width / 2) <= 1 && Math.abs(mid.y - real.height / 2) <= 1, `${k}: middle ${JSON.stringify(mid)}`);
    // Round trip stays within a pixel of the screenshot point.
    for (const p of [{ x: 10, y: 10 }, { x: 640, y: 360 }, { x: shot.width - 5, y: shot.height - 7 }]) {
      const back = c.realToShot(c.shotToReal(p, shot, real), shot, real);
      assert.ok(Math.abs(back.x - p.x) <= 1 && Math.abs(back.y - p.y) <= 1, `${k}: ${JSON.stringify(p)} -> ${JSON.stringify(back)}`);
    }
  }
  // 1920x1080 at 125%: real 2400x1350? No: DIP 1920x1080 at 1.25 means a 2400x1350 panel.
  const real = c.realScreen({ width: 1920, height: 1080 }, 1.25);
  assert.deepEqual(real, { width: 2400, height: 1350 });
  assert.deepEqual(c.shotToReal({ x: 640, y: 360 }, c.fitWithin(real), real), { x: 1200, y: 675 });
  // Clamped to the screen.
  assert.deepEqual(c.shotToReal({ x: 5000, y: -3 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }), { x: 1919, y: 0 });
});

test("pointer drift tolerance", () => {
  assert.equal(c.moved({ x: 100, y: 100 }, { x: 102, y: 97 }), false);
  assert.equal(c.moved({ x: 100, y: 100 }, { x: 110, y: 100 }), true);
});

const W = (title: string, exe = "app.exe", extra: Partial<c.WinInfo> = {}): c.WinInfo => ({ handle: 1, title, className: "AppWindow", exe, own: false, elevated: false, ...extra });
test("protected windows (passwords, security, money)", () => {
  const yes = [
    "1Password", "Vault - Bitwarden", "Database.kdbx - KeePassXC", "LastPass", "Dashlane", "Keeper Password Manager",
    "Windows Security", "User Account Control", "Credential Manager", "Sécurité Windows",
    "Chase Online Banking - Google Chrome", "PayPal: Send money - Microsoft Edge", "Checkout - Amazon.com", "Revolut",
    "BNP Paribas - Ma banque", "Deutsche Bank Online", "Banco Santander", "Ziraat Bankası", "بنك مصر", "Coinbase - Buy crypto", "MetaMask",
    "Rabobank - Internetbankieren", "MyBank Login", "HSBC UK", "Charles Schwab | Accounts", "Wise - Send money", "Chase", "Stripe Dashboard",
  ];
  for (const t of yes) assert.ok(c.windowVerdict(W(t)), t);
  const no = ["Untitled - Notepad", "Document1 - Word", "Inbox - Outlook", "Downloads - File Explorer", "Visual Studio Code", "Banner design.psd - Photoshop", "Spotify", "Keep notes", "Purchase order.xlsx - Excel", "Otherwise - Word"];
  for (const t of no) assert.equal(c.windowVerdict(W(t)), null, t);
  assert.equal(c.windowVerdict(W("Vault", "bitwarden.exe"))?.reason, "password");
  assert.equal(c.windowVerdict(W("", "consent.exe"))?.reason, "security");
  assert.equal(c.windowVerdict(W("PayPal"))?.reason, "money");
  assert.equal(c.moneyTitle("Rabobank"), true);
  assert.equal(c.moneyTitle("purchase"), false);
});

test("windows that can run programs or change the system are refused", () => {
  const titles = ["Run", "Exécuter", "Windows PowerShell", "PowerShell 7", "Administrator: Command Prompt", "Command Prompt", "C:\\WINDOWS\\system32\\cmd.exe", "Windows Terminal", "Task Scheduler", "Registry Editor", "Services", "Computer Management", "Local Group Policy Editor", "Settings", "Microsoft Store", "Task Manager", "Control Panel", "Start", "Search"];
  for (const t of titles) assert.equal(c.windowVerdict(W(t, "explorer.exe"))?.reason, "system", t);
  for (const exe of ["cmd.exe", "powershell.exe", "pwsh.exe", "windowsterminal.exe", "regedit.exe", "taskmgr.exe", "mmc.exe", "systemsettings.exe", "startmenuexperiencehost.exe", "searchhost.exe", "winstore.app.exe"]) assert.equal(c.windowVerdict(W("anything", exe))?.reason, "system", exe);
  for (const cls of ["Shell_TrayWnd", "ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS", "MMCMainFrame"]) assert.equal(c.windowVerdict(W("", "explorer.exe", { className: cls }))?.reason, "system", cls);
  assert.equal(c.windowVerdict(W("Notepad", "notepad.exe")), null);
  assert.equal(c.windowVerdict(W("App settings window", "app.exe")), null);
});

test("own, elevated and unknown windows are refused", () => {
  assert.equal(c.windowVerdict(W("oovi", "", { own: true }))?.reason, "own");
  assert.equal(c.windowVerdict(W("Notepad", "notepad.exe", { elevated: true }))?.reason, "elevated");
  assert.equal(c.windowVerdict(null)?.reason, "unknown");
  assert.equal(c.windowVerdict(W("", ""))?.reason, "unknown");
  // A context menu: no title, but its program is known.
  assert.equal(c.windowVerdict(W("", "notepad.exe", { className: "#32768" })), null);
});

test("screenshot masks: oovi's and private windows, where they show", () => {
  const screen = { width: 1920, height: 1080 };
  assert.deepEqual(c.subtractRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 5, height: 5 }), [{ x: 0, y: 0, width: 10, height: 10 }]);
  assert.deepEqual(c.subtractRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }), []);
  const parts = c.subtractRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 3, y: 3, width: 4, height: 4 });
  assert.equal(parts.reduce((n, r) => n + r.width * r.height, 0), 100 - 16);
  // oovi maximized behind a notepad window: only the uncovered part is masked.
  const windows: c.WinInfo[] = [
    W("Notepad", "notepad.exe", { rect: { x: 100, y: 100, width: 800, height: 600 } }),
    W("", "overlay", { own: true, overlay: true, rect: { x: 740, y: 10, width: 440, height: 48 } }),
    W("Vault - Bitwarden", "bitwarden.exe", { rect: { x: 1500, y: 0, width: 600, height: 400 } }),
    W("oovi", "", { own: true, rect: { x: -8, y: -8, width: 1936, height: 1096 } }),
  ];
  const m = c.maskRects(windows, screen);
  const area = m.reduce((n, r) => n + r.width * r.height, 0);
  // Bitwarden clipped to the screen: 420x400 (masked windows don't cover each other: overlaps count twice).
  // oovi: the whole screen minus the notepad window.
  assert.equal(area, 420 * 400 + (1920 * 1080 - 800 * 600));
  for (const r of m) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1920 && r.y + r.height <= 1080);
    // Nothing of the notepad window is masked.
    const ix = Math.max(0, Math.min(r.x + r.width, 900) - Math.max(r.x, 100));
    const iy = Math.max(0, Math.min(r.y + r.height, 700) - Math.max(r.y, 100));
    assert.equal(ix * iy, 0);
  }
  // The banner is never masked, and untitled windows don't hide a private one.
  assert.equal(c.maskRects([W("", "x.exe", { rect: { x: 0, y: 0, width: 1920, height: 1080 } }), W("PayPal", "chrome.exe", { rect: { x: 0, y: 0, width: 100, height: 100 } })], screen).length, 1);
  assert.deepEqual(c.maskRects([W("Notepad", "notepad.exe", { rect: { x: -1920, y: 0, width: 1920, height: 1080 } })], screen), []);
});

test("models with the computer toolset", () => {
  for (const m of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-fable-5-2", "claude-mythos-5-1", "anthropic.claude-opus-5-5"]) assert.ok(c.supportsDesktopModel(m), m);
  for (const m of ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-5-20250929", "gpt-5", "theoovi", "claude-3-5-sonnet-latest", ""]) assert.equal(c.supportsDesktopModel(m), false, m);
});

const shot = { width: 1280, height: 720 };
test("toolset actions are checked and parsed", () => {
  assert.deepEqual(c.parseDesktopCall("screenshot", {}, shot), { kind: "screenshot" });
  assert.deepEqual(c.parseDesktopCall("left_click", { coordinate: [100, 200] }, shot), { kind: "click", button: "left", count: 1, at: { x: 100, y: 200 }, modifiers: [] });
  assert.deepEqual(c.parseDesktopCall("double_click", {}, shot), { kind: "click", button: "left", count: 2, modifiers: [] });
  assert.deepEqual(c.parseDesktopCall("right_click", { coordinate: [5, 5], text: "ctrl+shift" }, shot), { kind: "click", button: "right", count: 1, at: { x: 5, y: 5 }, modifiers: ["control", "shift"] });
  assert.deepEqual(c.parseDesktopCall("triple_click", { coordinate: [1, 1] }, shot), { kind: "click", button: "left", count: 3, at: { x: 1, y: 1 }, modifiers: [] });
  assert.deepEqual(c.parseDesktopCall("left_click_drag", { start_coordinate: [1, 2], coordinate: [3, 4] }, shot), { kind: "drag", from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, modifiers: [] });
  assert.deepEqual(c.parseDesktopCall("scroll", { scroll_direction: "down", scroll_amount: 5, coordinate: [640, 360] }, shot), { kind: "scroll", direction: "down", amount: 5, at: { x: 640, y: 360 }, modifiers: [] });
  assert.deepEqual(c.parseDesktopCall("zoom", { region: [100, 50, 20, 10] }, shot), { kind: "zoom", region: { x: 20, y: 10, width: 80, height: 40 } });
  assert.deepEqual(c.parseDesktopCall("key", { text: "ctrl+s" }, shot), { kind: "key", combos: [{ key: "s", modifiers: ["control"] }], repeat: 1 });
  assert.deepEqual(c.parseDesktopCall("key", { text: "Return", repeat: 3 }, shot), { kind: "key", combos: [{ key: "enter", modifiers: [] }], repeat: 3 });
  assert.deepEqual(c.parseDesktopCall("key", { text: "shift+Tab" }, shot), { kind: "key", combos: [{ key: "tab", modifiers: ["shift"] }], repeat: 1 });
  assert.deepEqual(c.parseDesktopCall("key", { text: "ctrl+a Delete" }, shot), { kind: "key", combos: [{ key: "a", modifiers: ["control"] }, { key: "delete", modifiers: [] }], repeat: 1 });
  assert.deepEqual(c.parseDesktopCall("key", { text: "Page_Down" }, shot), { kind: "key", combos: [{ key: "pagedown", modifiers: [] }], repeat: 1 });
  assert.deepEqual(c.parseDesktopCall("key", { text: "ctrl++" }, shot), { kind: "key", combos: [{ key: "+", modifiers: ["control"] }], repeat: 1 });
  assert.deepEqual(c.parseDesktopCall("hold_key", { text: "shift", duration: 60 }, shot), { kind: "hold_key", combo: { key: "shift", modifiers: [] }, seconds: 10 });
  assert.deepEqual(c.parseDesktopCall("type", { text: "hello" }, shot), { kind: "type", text: "hello" });
  assert.deepEqual(c.parseDesktopCall("type", { text: "a\u0007b\u202Ec\r\nd\te" }, shot), { kind: "type", text: "abc\nd\te" });
  assert.deepEqual(c.parseDesktopCall("type", { text: "x".repeat(500) }, shot), { kind: "type", text: "x".repeat(500) });
  assert.match(c.parseDesktopCall("type", { text: "x".repeat(501) }, shot) as string, /Split it into several type calls of at most 500/);
  assert.deepEqual(c.parseDesktopCall("key", { text: "a", repeat: 20 }, shot), { kind: "key", combos: [{ key: "a", modifiers: [] }], repeat: 20 });
  assert.deepEqual(c.parseDesktopCall("wait", { duration: 2 }, shot), { kind: "wait", seconds: 2 });
  assert.deepEqual(c.parseDesktopCall("cursor_position", {}, shot), { kind: "cursor_position" });
  assert.deepEqual(c.parseDesktopCall("mouse_move", { coordinate: [0, 0] }, shot), { kind: "move", at: { x: 0, y: 0 } });

  const bad: [string, Record<string, unknown>][] = [
    ["left_click", { coordinate: [1280, 10] }],
    ["left_click", { coordinate: [-1, 10] }],
    ["left_click", { coordinate: "10,10" }],
    ["left_click", { coordinate: [1, 2], text: "hyper" }],
    ["left_click_drag", { coordinate: [3, 4] }],
    ["mouse_move", {}],
    ["scroll", { scroll_direction: "sideways" }],
    ["scroll", { scroll_direction: "up", scroll_amount: 500 }],
    ["zoom", { region: [1, 2, 3] }],
    ["zoom", { region: [10, 10, 11, 11] }],
    ["key", {}],
    ["key", { text: "ctrl+alt+Delete" }],
    ["key", { text: "foo+s" }],
    ["key", { text: "NotAKey" }],
    ["key", { text: "a", repeat: 0 }],
    ["key", { text: "a", repeat: 21 }],
    ["key", { text: "super" }],
    ["key", { text: "super+r" }],
    ["key", { text: "win+e" }],
    ["key", { text: "cmd+space" }],
    ["key", { text: "alt+tab" }],
    ["key", { text: "alt+Tab Tab space" }],
    ["key", { text: "alt+Escape" }],
    ["key", { text: "ctrl+Escape" }],
    ["key", { text: "ctrl+shift+Escape" }],
    ["key", { text: "alt+F4" }],
    ["key", { text: "Return super" }],
    ["hold_key", { text: "super", duration: 1 }],
    ["left_click", { coordinate: [5, 5], text: "super" }],
    ["scroll", { scroll_direction: "up", text: "win" }],
    ["left_click_drag", { start_coordinate: [1, 2], coordinate: [3, 4], text: "meta" }],
    ["type", { text: "" }],
    ["type", { text: "x".repeat(5000) }],
    ["type", { text: "\u0007\u0008" }],
    ["hold_key", { text: "shift" }],
    ["teleport", {}],
  ];
  for (const [m, i] of bad) assert.equal(typeof c.parseDesktopCall(m, i, shot), "string", `${m} ${JSON.stringify(i)}`);
});

test("scroll wheel deltas", () => {
  assert.deepEqual(c.wheelDelta("up", 3), { x: 0, y: 360 });
  assert.deepEqual(c.wheelDelta("down", 1), { x: 0, y: -120 });
  assert.deepEqual(c.wheelDelta("right", 2), { x: -240, y: 0 });
  assert.deepEqual(c.wheelDelta("left", 2), { x: 240, y: 0 });
});

test("typing turns new lines and tabs into key presses", () => {
  assert.deepEqual(c.typingPlan("a\r\nb\tc"), [{ text: "a" }, { key: "enter" }, { text: "b" }, { key: "tab" }, { text: "c" }]);
  assert.deepEqual(c.typingPlan("héllo 😀"), [{ text: "héllo 😀" }]);
});

test("descriptions for approvals", () => {
  const a = c.parseDesktopCall("left_click", { coordinate: [412, 230] }, shot);
  assert.equal(c.describeAction(a as c.DesktopAction), "Click at (412, 230)");
  const k = c.parseDesktopCall("key", { text: "ctrl+s" }, shot);
  assert.equal(c.describeAction(k as c.DesktopAction), "Press Ctrl+S");
  const t = c.parseDesktopCall("type", { text: "x".repeat(80) }, shot);
  assert.equal(c.describeAction(t as c.DesktopAction), "Type this text (80 characters)");
  assert.equal(c.markWhitespace("a\nb\tc"), "a⏎\nb⇥\tc");
});

test("approval rules", () => {
  assert.equal(c.desktopNeedsOk("screenshot", { granted: false, askEvery: false, first: true }), "grant");
  assert.equal(c.desktopNeedsOk("left_click", { granted: false, askEvery: true, first: false }), "action");
  assert.equal(c.desktopNeedsOk("screenshot", { granted: false, askEvery: true, first: false }), null);
  assert.equal(c.desktopNeedsOk("left_click", { granted: false, askEvery: false, first: false }), null);
  assert.equal(c.desktopNeedsOk("left_click", { granted: true, askEvery: true, first: true }), "action");
  assert.equal(c.desktopNeedsOk("zoom", { granted: true, askEvery: true, first: true }), null);
  assert.equal(c.desktopNeedsOk("type", { granted: true, askEvery: false, first: true }), null);
});

test("only the newest 3 screenshots stay in the model's view", () => {
  const shotMsg = (i: number) => ({ role: "tool" as const, results: [{ id: `t${i}`, name: "desktop_screenshot", content: `shot ${i}`, shot: `desk-${i}`, image: `/api/shots/desk-${i}` }] });
  const history = [
    { role: "user" as const, content: "go" },
    shotMsg(1),
    { role: "assistant" as const, text: "", toolCalls: [] },
    shotMsg(2),
    shotMsg(3),
    { role: "tool" as const, results: [{ id: "x", name: "desktop_left_click", content: "OK" }, { id: "t4", name: "desktop_zoom", content: "zoom", shot: "desk-4" }] },
    shotMsg(5),
  ];
  const out = c.pruneDesktopShots(history);
  const kept = out.flatMap((m) => (m.role === "tool" ? m.results.filter((r) => r.shot).map((r) => r.shot) : []));
  assert.deepEqual(kept, ["desk-3", "desk-4", "desk-5"]);
  const first = out[1];
  assert.ok(first?.role === "tool" && first.results[0]?.content.includes("Older screenshot removed") && first.results[0]?.image === "/api/shots/desk-1");
  // The input isn't changed.
  assert.equal((history[1] as ReturnType<typeof shotMsg>).results[0]?.shot, "desk-1");
  assert.equal(c.pruneDesktopShots(history, 10).length, history.length);
});

test("internal names", () => {
  assert.equal(c.desktopName("type"), "desktop_type");
  assert.equal(c.isDesktopName("desktop_type"), true);
  assert.equal(c.isDesktopName("type"), false);
  assert.equal(c.memberOf("desktop_left_click"), "left_click");
});
