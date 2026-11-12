// Desktop control (Beta): the pure parts, with no Node or Electron imports so they can be
// unit-tested on their own. lib/desktop-control.ts runs the actions; this file only
// decides what an action means, where it lands and whether it's allowed.
//
// The model uses Anthropic's computer toolset (computer_toolset_20260801): one `tools`
// entry, and calls arrive as tool_use blocks named after the member ("left_click",
// "type"…) with toolset_name "computer". Inside oovi those calls are named
// "desktop_<member>" so they never collide with the browser tools (which also have a
// "type"); lib/llm.ts converts the names on the way in and out.
import type { Msg } from "./types";

export const DESKTOP_TOOLSET_TYPE = "computer_toolset_20260801";
/** toolset_name on the model's tool_use blocks and on every tool_result that answers one. */
export const DESKTOP_TOOLSET_NAME = "computer";
/** Internal name prefix of a desktop call. */
export const DESKTOP_PREFIX = "desktop_";
/** The ToolSpec name that stands for the whole toolset (lib/llm.ts sends the toolset entry instead). */
export const DESKTOP_MARKER = "computer_toolset";
/** About what the toolset definition adds to a request (Anthropic: ~4,520 tokens with its default members). */
export const DESKTOP_TOOLSET_TOKENS = 4600;
/** What one screenshot costs the model, roughly (1280x720 JPEG). */
export const DESKTOP_SHOT_TOKENS = 1500;
/** Screenshots kept in the model's view; older ones become a text note. */
export const KEEP_SHOTS = 3;
/** Screenshots are scaled to fit this box (Anthropic's recommendation for desktop tasks). */
export const SHOT_BOX = { width: 1280, height: 720 } as const;
/** The cursor may drift this far (pixels) from where oovi put it before it counts as the user's hand. */
export const MOVE_TOLERANCE = 4;
export const IDLE_LIMIT_MS = 20 * 60_000;
export const NOT_EXECUTED = "Not executed: an earlier computer action in this turn failed.";
export const USER_MOVED = "The user moved the mouse; stopped. Ask before continuing.";
export const PROTECTED = "This window is protected (passwords/banking): ask the user to do this part.";
export const SYSTEM_WINDOW = "This window can run programs or change the system (a terminal, Run, Settings, Task Manager, the taskbar or Start…): ask the user to do this part.";
export const OWN_WINDOW = "That is oovi's own window, and bots can't control oovi itself. Ask the user to minimize oovi or move it aside, then take a new screenshot.";
export const UNKNOWN_WINDOW = "oovi can't tell which window this would reach, so it won't act there. Take a new screenshot, or ask the user.";
export const ELEVATED_WINDOW =
  "This window runs as administrator. Windows doesn't let apps control it (nor User Account Control prompts or the lock screen): ask the user to do this part.";
/** An approved desktop action must run within this long, or the user is asked again. */
export const APPROVAL_TTL_MS = 20 * 60_000;
/** Typing is sent in chunks this long, and the window is checked again before each one. */
export const TYPE_CHUNK = 40;

export const DESKTOP_MEMBERS = [
  "screenshot",
  "zoom",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "left_click_drag",
  "mouse_move",
  "left_mouse_down",
  "left_mouse_up",
  "cursor_position",
  "scroll",
  "type",
  "key",
  "hold_key",
  "wait",
] as const;
export type DesktopMember = (typeof DESKTOP_MEMBERS)[number];

export const isDesktopName = (name: string) => name.startsWith(DESKTOP_PREFIX);
export const memberOf = (name: string) => name.slice(DESKTOP_PREFIX.length);
export const desktopName = (member: string) => `${DESKTOP_PREFIX}${member}`;
const isMember = (m: string): m is DesktopMember => (DESKTOP_MEMBERS as readonly string[]).includes(m);

/** Actions that only look: they never need a per-action OK (the first action of a task always does). */
export const LOOK_ONLY = new Set<string>(["screenshot", "zoom", "cursor_position", "wait"]);

// ---------- which models ----------

/**
 * Claude models that accept computer_toolset_20260801 (Anthropic's computer use docs, Nov 2026):
 * Haiku 5.5, Sonnet 5.5, Opus 5.5, Opus 5, Sonnet 5, Opus 4.8, and Fable / Mythos 5.x.
 * Older Claude models only have the beta computer tool, which oovi doesn't use.
 */
export function supportsDesktopModel(model: string): boolean {
  const m = model.trim().toLowerCase().replace(/^anthropic\./, "").match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d+))?(?:$|[-@])/);
  if (!m) return false;
  const v = Number(m[2]) + Number(m[3] && m[3].length <= 2 ? m[3] : 0) / 10;
  const family = m[1];
  if (family === "fable" || family === "mythos") return v >= 5;
  if (family === "haiku") return v >= 5.5;
  if (family === "opus") return v >= 4.8;
  return v >= 5; // sonnet
}

// ---------- coordinates ----------

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/** The screenshot size for a screen: fits SHOT_BOX, keeps the aspect ratio, never scales up. */
export function fitWithin(real: Size, box: Size = SHOT_BOX): Size {
  const k = Math.min(1, box.width / real.width, box.height / real.height);
  return { width: Math.max(1, Math.round(real.width * k)), height: Math.max(1, Math.round(real.height * k)) };
}

/** A point in screenshot pixels -> the real screen (physical pixels of the primary display). */
export function shotToReal(p: Point, shot: Size, real: Size): Point {
  const x = Math.round(((p.x + 0.5) * real.width) / shot.width - 0.5);
  const y = Math.round(((p.y + 0.5) * real.height) / shot.height - 0.5);
  return { x: Math.min(real.width - 1, Math.max(0, x)), y: Math.min(real.height - 1, Math.max(0, y)) };
}

/** A real-screen point -> screenshot pixels (for cursor_position). */
export function realToShot(p: Point, shot: Size, real: Size): Point {
  return {
    x: Math.min(shot.width - 1, Math.max(0, Math.round(((p.x + 0.5) * shot.width) / real.width - 0.5))),
    y: Math.min(shot.height - 1, Math.max(0, Math.round(((p.y + 0.5) * shot.height) / real.height - 0.5))),
  };
}

/**
 * The real screen size from what Electron reports for the primary display: its size in
 * DIPs times its scale factor (Windows display scaling: 125% -> 1.25). `native` is what
 * the input library reports (physical pixels in a DPI-aware process); it wins when both
 * exist, because that's the space the mouse moves in.
 */
export function realScreen(dip: Size, scaleFactor: number, native?: Size | null): Size {
  if (native && native.width > 0 && native.height > 0) return { width: native.width, height: native.height };
  const k = scaleFactor > 0 ? scaleFactor : 1;
  return { width: Math.round(dip.width * k), height: Math.round(dip.height * k) };
}

export const moved = (a: Point, b: Point, tolerance = MOVE_TOLERANCE) => Math.abs(a.x - b.x) > tolerance || Math.abs(a.y - b.y) > tolerance;

// ---------- windows oovi refuses ----------

export type Rect = { x: number; y: number; width: number; height: number };
/** What oovi knows about a top-level window (electron/win32-windows.cjs). Physical pixels. */
export type WinInfo = { handle: number; title: string; className: string; exe: string; own: boolean; elevated: boolean; rect?: Rect; overlay?: boolean };
export type Refusal = { reason: "unknown" | "own" | "elevated" | "password" | "security" | "money" | "system"; message: string };

const PASSWORD_EXE = new Set(["1password.exe", "bitwarden.exe", "keepass.exe", "keepassxc.exe", "lastpass.exe", "dashlane.exe", "keeperpasswordmanager.exe", "keeper.exe", "nordpass.exe", "proton pass.exe", "protonpass.exe", "roboform.exe", "robotaskbaricon.exe", "enpass.exe"]);
const PASSWORD_TITLE = /1password|bitwarden|keepass|lastpass|dashlane|keeper password|keeper security|nordpass|proton pass|roboform|enpass/i;
const SECURITY_EXE = new Set(["consent.exe", "credentialuibroker.exe", "lockapp.exe", "logonui.exe", "sechealthui.exe", "securityhealthhost.exe"]);
const SECURITY_TITLE = /windows security|credential manager|enter (network )?credentials|user account control|windows hello|sécurité windows|windows-sicherheit|seguridad de windows|windows güvenliği|أمان windows/i;
/** Programs that run commands or change the system (Windows Terminal, consoles, Settings, Store, Start, Search, MMC snap-ins…). */
const SYSTEM_EXE = new Set([
  "cmd.exe", "powershell.exe", "powershell_ise.exe", "pwsh.exe", "windowsterminal.exe", "wt.exe", "openconsole.exe", "conhost.exe",
  "bash.exe", "wsl.exe", "wslhost.exe", "mintty.exe", "git-bash.exe", "regedit.exe", "regedt32.exe", "taskmgr.exe", "mmc.exe",
  "systemsettings.exe", "systemsettingsadminflows.exe", "winstore.app.exe", "startmenuexperiencehost.exe", "searchhost.exe",
  "searchapp.exe", "searchui.exe", "shellexperiencehost.exe", "msiexec.exe", "control.exe", "rundll32.exe", "wscript.exe",
  "cscript.exe", "mshta.exe", "msconfig.exe", "perfmon.exe", "resmon.exe", "eventvwr.exe", "systempropertiesadvanced.exe",
  "systempropertiesprotection.exe", "systempropertiesremote.exe", "netplwiz.exe", "useraccountcontrolsettings.exe", "quickassist.exe",
]);
/** Taskbar (Start, search, pinned apps), consoles, Task Manager, Registry Editor, MMC (Services, Task Scheduler, Group Policy…). */
const SYSTEM_CLASS = new Set(["Shell_TrayWnd", "Shell_SecondaryTrayWnd", "ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS", "TaskManagerWindow", "RegEdit_RegEdit", "MMCMainFrame"]);
const SYSTEM_TITLE = new RegExp(
  [
    "^(run|exécuter|ausführen|ejecutar|çalıştır|تشغيل)$",
    "windows powershell", "^powershell", "^administrator: ", "command prompt", "invite de commandes", "eingabeaufforderung", "símbolo del sistema", "komut istemi", "موجه الأوامر",
    "\\bcmd\\.exe", "windows terminal", "task scheduler", "planificateur de tâches", "aufgabenplanung", "programador de tareas", "görev zamanlayıcı",
    "registry editor", "éditeur du registre", "registrierungs-editor", "editor del registro", "kayıt defteri düzenleyicisi",
    "^services$", "^dienste$", "^servicios$", "^hizmetler$",
    "computer management", "gestion de l'ordinateur", "computerverwaltung", "administración de equipos", "bilgisayar yönetimi",
    "group policy", "stratégie de groupe", "gruppenrichtlinie", "directiva de grupo", "grup ilkesi",
    "^settings$", "^paramètres$", "^einstellungen$", "^configuración$", "^ayarlar$", "^الإعدادات$",
    "microsoft store", "task manager", "gestionnaire des tâches", "task-manager", "administrador de tareas", "görev yöneticisi",
    "control panel", "panneau de configuration", "systemsteuerung", "panel de control", "denetim masası", "device manager", "event viewer",
    "^start$", "^search$", "^démarrer$", "^rechercher$", "^suche$", "^buscar$", "^ara$", "^بحث$",
  ].join("|"),
  "i",
);
/** Banking, payment, crypto and broker words, matched anywhere in the title ("Rabobank", "MyBank"). Best effort. */
const MONEY_ANYWHERE =
  /bank|banque|bancaire|banco|banca|paypal|wallet|portefeuille|crypto|coinbase|binance|kraken|bitstamp|metamask|brokerage|courtier|revolut|venmo|zelle|stripe|checkout|payment|paiement|zahlung|ödeme|hsbc|barclays|santander|natwest|lloyds|schwab|fidelity|robinhood|e\*?trade|ameritrade|interactive brokers|wells ?fargo|capital ?one|american express|amex|credit card|debit card|carte bancaire|kreditkarte|tarjeta|monzo|klarna|western union|moneygram|cash app|apple pay|google pay|bunq|trade republic|degiro|etoro|boursorama|sparkasse|volksbank|commerzbank|postfinance|بنك|مصرف|دفع/i;
/** Short names that are only names on their own ("Wise", not "otherwise"; "Chase", not "purchase"). */
const MONEY_WORD = /\b(wise|chase|citi|n26|sofi|ing|pago|iban|swift)\b/i;

export const moneyTitle = (title: string) => MONEY_ANYWHERE.test(title) || MONEY_WORD.test(title);

/** Why oovi refuses to act on (or reveal) a window, or null when it may. null window = unknown = refused. */
export function windowVerdict(w: WinInfo | null | undefined): Refusal | null {
  if (!w) return { reason: "unknown", message: UNKNOWN_WINDOW };
  if (w.own) return { reason: "own", message: OWN_WINDOW };
  const title = (w.title || "").normalize("NFKC").trim();
  const exe = (w.exe || "").toLowerCase();
  if (PASSWORD_EXE.has(exe) || PASSWORD_TITLE.test(title)) return { reason: "password", message: PROTECTED };
  if (SECURITY_EXE.has(exe) || SECURITY_TITLE.test(title)) return { reason: "security", message: PROTECTED };
  if (w.elevated) return { reason: "elevated", message: ELEVATED_WINDOW };
  if (SYSTEM_EXE.has(exe) || SYSTEM_CLASS.has(w.className) || SYSTEM_TITLE.test(title)) return { reason: "system", message: SYSTEM_WINDOW };
  if (moneyTitle(title)) return { reason: "money", message: PROTECTED };
  if (!title && !exe) return { reason: "unknown", message: UNKNOWN_WINDOW };
  return null;
}

/** Windows blacked out in screenshots: oovi's own (other chats, settings) and private ones (passwords, security, money). */
export function maskedWindow(w: WinInfo): boolean {
  if (w.overlay) return false;
  const v = windowVerdict(w);
  return !!v && (v.reason === "own" || v.reason === "password" || v.reason === "security" || v.reason === "money");
}

// ---------- screenshot masking ----------

/** r minus cut: up to four rectangles. */
export function subtractRect(r: Rect, cut: Rect): Rect[] {
  const x1 = Math.max(r.x, cut.x);
  const y1 = Math.max(r.y, cut.y);
  const x2 = Math.min(r.x + r.width, cut.x + cut.width);
  const y2 = Math.min(r.y + r.height, cut.y + cut.height);
  if (x1 >= x2 || y1 >= y2) return [r];
  const out: Rect[] = [];
  if (y1 > r.y) out.push({ x: r.x, y: r.y, width: r.width, height: y1 - r.y });
  if (y2 < r.y + r.height) out.push({ x: r.x, y: y2, width: r.width, height: r.y + r.height - y2 });
  if (x1 > r.x) out.push({ x: r.x, y: y1, width: x1 - r.x, height: y2 - y1 });
  if (x2 < r.x + r.width) out.push({ x: x2, y: y1, width: r.x + r.width - x2, height: y2 - y1 });
  return out;
}

/** The parts of r not covered by any rectangle above it. */
export function visibleParts(r: Rect, above: Rect[]): Rect[] {
  let parts = [r];
  for (const a of above) {
    parts = parts.flatMap((p) => subtractRect(p, a));
    if (!parts.length) break;
  }
  return parts;
}

export function clipRect(r: Rect, screen: Size): Rect | null {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const w = Math.min(screen.width, r.x + r.width) - x;
  const h = Math.min(screen.height, r.y + r.height) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
}

/**
 * Rectangles to black out on the primary screen, from the visible windows (top of the z-order
 * first). A masked window is hidden where it shows; windows with a title above it cover it
 * (untitled ones may be transparent overlays, so they never hide a masked window).
 */
export function maskRects(windows: WinInfo[], screen: Size, mask: (w: WinInfo) => boolean = maskedWindow): Rect[] {
  const out: Rect[] = [];
  const above: Rect[] = [];
  for (const w of windows) {
    if (w.overlay || !w.rect) continue;
    const r = clipRect(w.rect, screen);
    if (!r) continue;
    if (mask(w)) out.push(...visibleParts(r, above));
    else if (w.title.trim()) above.push(r);
  }
  return out;
}

// ---------- keys ----------

const KEY_ALIASES: Record<string, string> = {
  return: "enter",
  enter: "enter",
  kp_enter: "enter",
  tab: "tab",
  escape: "escape",
  esc: "escape",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  insert: "insert",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  home: "home",
  end: "end",
  page_up: "pageup",
  pageup: "pageup",
  prior: "pageup",
  page_down: "pagedown",
  pagedown: "pagedown",
  next: "pagedown",
  space: "space",
  print: "printscreen",
  printscreen: "printscreen",
  menu: "menu",
  caps_lock: "caps_lock",
  num_lock: "num_lock",
  scroll_lock: "scroll_lock",
  pause: "pause",
  plus: "+",
  minus: "-",
  equal: "=",
  period: ".",
  comma: ",",
  slash: "/",
  backslash: "\\",
  semicolon: ";",
  apostrophe: "'",
  quotedbl: '"',
  bracketleft: "[",
  bracketright: "]",
  grave: "`",
  xf86audiomute: "audio_mute",
  xf86audioraisevolume: "audio_vol_up",
  xf86audiolowervolume: "audio_vol_down",
  xf86audioplay: "audio_play",
  xf86audionext: "audio_next",
  xf86audioprev: "audio_prev",
};

const MODIFIERS: Record<string, string> = {
  ctrl: "control",
  control: "control",
  control_l: "control",
  control_r: "control",
  shift: "shift",
  shift_l: "shift",
  shift_r: "shift",
  alt: "alt",
  alt_l: "alt",
  alt_r: "alt",
  option: "alt",
  super: "command",
  super_l: "command",
  super_r: "command",
  win: "command",
  windows: "command",
  meta: "command",
  cmd: "command",
  command: "command",
};

/** One key or combination ("ctrl+shift+t") in the input library's names: the key last, modifiers first. */
export type KeyCombo = { key: string; modifiers: string[] };

function keyName(raw: string): string | null {
  const k = raw.trim();
  if (!k) return null;
  const low = k.toLowerCase();
  if (KEY_ALIASES[low]) return KEY_ALIASES[low]!;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(low)) return low;
  if (/^kp_[0-9]$/.test(low)) return `numpad_${low.slice(3)}`;
  if ([...k].length === 1) return k.length === 1 && /[A-Z]/.test(k) ? low : k;
  return null;
}

/** "ctrl+s" -> {key:"s", modifiers:["control"]}. A modifier alone ("super") is a key press of its own. */
export function parseCombo(text: string): KeyCombo | string {
  const parts = text.split("+").map((p) => p.trim());
  // "ctrl++" means ctrl and the plus key.
  if (text.trim().endsWith("++")) parts.splice(parts.length - 2, 2, "+");
  if (parts.some((p) => !p)) return `"${text}" isn't a key combination I know.`;
  const mods: string[] = [];
  for (const p of parts.slice(0, -1)) {
    const m = MODIFIERS[p.toLowerCase()];
    if (!m) return `"${p}" isn't a modifier key (use ctrl, shift, alt or super).`;
    if (!mods.includes(m)) mods.push(m);
  }
  const last = parts.at(-1)!;
  const asMod = MODIFIERS[last.toLowerCase()];
  if (asMod) return { key: asMod, modifiers: mods.filter((m) => m !== asMod) };
  const key = keyName(last);
  if (!key) return `"${last}" isn't a key I know.`;
  return { key, modifiers: mods };
}

/**
 * Blocked even with approval: keys that switch or launch windows behind oovi's back (the Windows
 * key in any combination opens Start, Run, Search, Settings…; Alt+Tab, Alt+Esc, Ctrl+Esc switch
 * windows or open Start; Ctrl+Shift+Esc opens Task Manager; Alt+F4 closes things).
 */
export function forbiddenCombo(c: KeyCombo): string | null {
  const m = new Set(c.modifiers);
  if (c.key === "command" || m.has("command")) return "The Windows key can't be used (it opens Start, Run and Settings). Click what you need instead.";
  if (m.has("alt") && (c.key === "tab" || c.key === "escape")) return "Alt+Tab and Alt+Esc can't be used. Click the window you need instead (take a screenshot first).";
  if (m.has("control") && c.key === "escape") return "Ctrl+Esc and Ctrl+Shift+Esc can't be used.";
  if (m.has("alt") && c.key === "f4") return "Alt+F4 can't be used. Ask the user to close windows.";
  if (m.has("control") && m.has("alt") && c.key === "delete") return "Ctrl+Alt+Delete can't be sent.";
  return null;
}

/** How a key looks in an approval card: "Ctrl+S". */
export function comboLabel(c: KeyCombo): string {
  const name = (s: string) => (s === "control" ? "Ctrl" : s === "command" ? "Win" : s.length === 1 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));
  return [...c.modifiers.map(name), name(c.key)].join("+");
}

// ---------- actions ----------

export type Button = "left" | "right" | "middle";
export type DesktopAction =
  | { kind: "screenshot" }
  | { kind: "zoom"; region: { x: number; y: number; width: number; height: number } }
  | { kind: "click"; button: Button; count: 1 | 2 | 3; at?: Point; modifiers: string[] }
  | { kind: "drag"; from: Point; to: Point; modifiers: string[] }
  | { kind: "move"; at: Point }
  | { kind: "mouse_down" }
  | { kind: "mouse_up" }
  | { kind: "cursor_position" }
  | { kind: "scroll"; direction: "up" | "down" | "left" | "right"; amount: number; at?: Point; modifiers: string[] }
  | { kind: "type"; text: string }
  | { kind: "key"; combos: KeyCombo[]; repeat: number }
  | { kind: "hold_key"; combo: KeyCombo; seconds: number }
  | { kind: "wait"; seconds: number };

export const MAX_TYPE = 500;
export const MAX_REPEAT = 20;
const MAX_WAIT = 30;
const MAX_HOLD = 10;
const MAX_SCROLL = 30;

function point(v: unknown, shot: Size, field: string): Point | string {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return `${field} must be [x, y] in screenshot pixels.`;
  const [x, y] = v as [number, number];
  if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) return `${field} (${x}, ${y}) is outside the screen (${shot.width}x${shot.height}). Take a screenshot and use its coordinates.`;
  return { x: Math.round(x), y: Math.round(y) };
}

function modifiers(v: unknown): string[] | string {
  if (v === undefined || v === null || v === "") return [];
  if (typeof v !== "string") return "text (modifier keys) must be a string like \"ctrl\" or \"ctrl+shift\".";
  const out: string[] = [];
  for (const p of v.split("+")) {
    const m = MODIFIERS[p.trim().toLowerCase()];
    if (!m) return `"${p}" isn't a modifier key (use shift, ctrl or alt).`;
    if (m === "command") return "The Windows key can't be held while clicking.";
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** Text to type without control characters (other than new lines and tabs) and invisible direction marks. */
export function cleanTypedText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "");
}

const CLICKS: Record<string, { button: Button; count: 1 | 2 | 3 }> = {
  left_click: { button: "left", count: 1 },
  right_click: { button: "right", count: 1 },
  middle_click: { button: "middle", count: 1 },
  double_click: { button: "left", count: 2 },
  triple_click: { button: "left", count: 3 },
};

/** A desktop call checked and turned into an action, or the error to give the model. `shot`: the screenshot size. */
export function parseDesktopCall(member: string, input: Record<string, unknown>, shot: Size): DesktopAction | string {
  if (!isMember(member)) return `Unknown computer action: ${member}.`;
  const i = input ?? {};
  switch (member) {
    case "screenshot":
      return { kind: "screenshot" };
    case "cursor_position":
      return { kind: "cursor_position" };
    case "left_mouse_down":
      return { kind: "mouse_down" };
    case "left_mouse_up":
      return { kind: "mouse_up" };
    case "zoom": {
      const r = i.region;
      if (!Array.isArray(r) || r.length !== 4 || !r.every((n) => typeof n === "number" && Number.isFinite(n))) return "region must be [x0, y0, x1, y1] in screenshot pixels.";
      const [x0, y0, x1, y1] = (r as number[]).map((n) => Math.round(n)) as [number, number, number, number];
      const x = Math.max(0, Math.min(x0, x1));
      const y = Math.max(0, Math.min(y0, y1));
      const w = Math.min(shot.width, Math.max(x0, x1)) - x;
      const h = Math.min(shot.height, Math.max(y0, y1)) - y;
      if (w < 4 || h < 4) return "region is too small or outside the screen.";
      return { kind: "zoom", region: { x, y, width: w, height: h } };
    }
    case "left_click":
    case "right_click":
    case "middle_click":
    case "double_click":
    case "triple_click": {
      const mods = modifiers(i.text);
      if (typeof mods === "string") return mods;
      let at: Point | undefined;
      if (i.coordinate !== undefined && i.coordinate !== null) {
        const p = point(i.coordinate, shot, "coordinate");
        if (typeof p === "string") return p;
        at = p;
      }
      return { kind: "click", ...CLICKS[member]!, ...(at ? { at } : {}), modifiers: mods };
    }
    case "left_click_drag": {
      const from = point(i.start_coordinate, shot, "start_coordinate");
      if (typeof from === "string") return from;
      const to = point(i.coordinate, shot, "coordinate");
      if (typeof to === "string") return to;
      const mods = modifiers(i.text);
      if (typeof mods === "string") return mods;
      return { kind: "drag", from, to, modifiers: mods };
    }
    case "mouse_move": {
      const at = point(i.coordinate, shot, "coordinate");
      return typeof at === "string" ? at : { kind: "move", at };
    }
    case "scroll": {
      const d = i.scroll_direction;
      if (d !== "up" && d !== "down" && d !== "left" && d !== "right") return 'scroll_direction must be "up", "down", "left" or "right".';
      const amount = typeof i.scroll_amount === "number" && Number.isFinite(i.scroll_amount) ? Math.round(i.scroll_amount) : 3;
      if (amount < 1 || amount > MAX_SCROLL) return `scroll_amount must be 1 to ${MAX_SCROLL}.`;
      const mods = modifiers(i.text);
      if (typeof mods === "string") return mods;
      let at: Point | undefined;
      if (i.coordinate !== undefined && i.coordinate !== null) {
        const p = point(i.coordinate, shot, "coordinate");
        if (typeof p === "string") return p;
        at = p;
      }
      return { kind: "scroll", direction: d, amount, ...(at ? { at } : {}), modifiers: mods };
    }
    case "type": {
      if (typeof i.text !== "string" || !i.text) return "text is required.";
      const text = cleanTypedText(i.text);
      if (!text) return "text has nothing to type.";
      if (text.length > MAX_TYPE) return `text is too long (${text.length} characters). Split it into several type calls of at most ${MAX_TYPE} characters each.`;
      return { kind: "type", text };
    }
    case "key": {
      if (typeof i.text !== "string" || !i.text.trim()) return 'text is required, e.g. "Return" or "ctrl+s".';
      const combos: KeyCombo[] = [];
      for (const part of i.text.trim().split(/\s+/)) {
        const c = parseCombo(part);
        if (typeof c === "string") return c;
        const bad = forbiddenCombo(c);
        if (bad) return bad;
        combos.push(c);
      }
      if (combos.length > 10) return "Send at most 10 keys per call.";
      const repeat = i.repeat === undefined || i.repeat === null ? 1 : Number(i.repeat);
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) return `repeat must be a whole number from 1 to ${MAX_REPEAT}.`;
      return { kind: "key", combos, repeat };
    }
    case "hold_key": {
      if (typeof i.text !== "string" || !i.text.trim()) return "text is required.";
      const c = parseCombo(i.text.trim());
      if (typeof c === "string") return c;
      const bad = forbiddenCombo(c);
      if (bad) return bad;
      const seconds = Number(i.duration);
      if (!Number.isFinite(seconds) || seconds <= 0) return "duration (seconds) is required.";
      return { kind: "hold_key", combo: c, seconds: Math.min(MAX_HOLD, seconds) };
    }
    case "wait": {
      const seconds = Number(i.duration ?? 1);
      if (!Number.isFinite(seconds) || seconds < 0) return "duration must be a number of seconds.";
      return { kind: "wait", seconds: Math.min(MAX_WAIT, seconds) };
    }
  }
  return `Unknown computer action: ${member}.`;
}

/** Wheel input for a scroll: Windows counts 120 per notch; up is positive, and the input library flips the horizontal sign. */
export function wheelDelta(direction: "up" | "down" | "left" | "right", amount: number): { x: number; y: number } {
  const n = 120 * amount;
  if (direction === "up") return { x: 0, y: n };
  if (direction === "down") return { x: 0, y: -n };
  if (direction === "right") return { x: -n, y: 0 };
  return { x: n, y: 0 };
}

/** A short line for the approval card and the chat ("Click at (412, 230)"). The window and typed text are shown apart. */
export function describeAction(a: DesktopAction): string {
  const at = (p?: Point) => (p ? ` at (${p.x}, ${p.y})` : " where the pointer is");
  const mods = (m: string[]) => (m.length ? ` holding ${m.map((x) => comboLabel({ key: x, modifiers: [] })).join("+")}` : "");
  switch (a.kind) {
    case "screenshot":
      return "Take a screenshot of your screen";
    case "zoom":
      return "Look closer at part of your screen";
    case "cursor_position":
      return "Check where the pointer is";
    case "wait":
      return `Wait ${a.seconds} s`;
    case "click": {
      const what = a.count === 3 ? "Triple-click" : a.count === 2 ? "Double-click" : a.button === "right" ? "Right-click" : a.button === "middle" ? "Middle-click" : "Click";
      return `${what}${at(a.at)}${mods(a.modifiers)}`;
    }
    case "drag":
      return `Drag from (${a.from.x}, ${a.from.y}) to (${a.to.x}, ${a.to.y})${mods(a.modifiers)}`;
    case "move":
      return `Move the pointer to (${a.at.x}, ${a.at.y})`;
    case "mouse_down":
      return "Press the mouse button";
    case "mouse_up":
      return "Release the mouse button";
    case "scroll":
      return `Scroll ${a.direction}${a.at ? ` at (${a.at.x}, ${a.at.y})` : ""}`;
    case "type":
      return `Type this text (${a.text.length} character${a.text.length === 1 ? "" : "s"})`;
    case "key":
      return `Press ${a.combos.map(comboLabel).join(", ")}${a.repeat > 1 ? ` ×${a.repeat}` : ""}`;
    case "hold_key":
      return `Hold ${comboLabel(a.combo)} for ${a.seconds} s`;
  }
}

/** Typed text with visible markers for new lines and tabs (approval cards, Telegram). */
export const markWhitespace = (text: string) => text.replace(/\t/g, "⇥\t").replace(/\n/g, "⏎\n");

/** Where a pointer action lands, in screenshot pixels (an empty list: where the pointer already is). */
export function pointsOf(a: DesktopAction): Point[] {
  if (a.kind === "click" || a.kind === "scroll") return a.at ? [a.at] : [];
  if (a.kind === "move") return [a.at];
  if (a.kind === "drag") return [a.from, a.to];
  return [];
}

export const isKeyboard = (a: DesktopAction) => a.kind === "type" || a.kind === "key" || a.kind === "hold_key";
export const isPointer = (a: DesktopAction) => a.kind === "click" || a.kind === "drag" || a.kind === "move" || a.kind === "mouse_down" || a.kind === "mouse_up" || a.kind === "scroll";

/** Text to type, split so new lines and tabs become Enter and Tab presses (typing "\n" does nothing in most apps). */
export function typingPlan(text: string): ({ text: string } | { key: "enter" | "tab" })[] {
  const out: ({ text: string } | { key: "enter" | "tab" })[] = [];
  let buf = "";
  for (const ch of text.replace(/\r\n?/g, "\n")) {
    if (ch === "\n" || ch === "\t") {
      if (buf) out.push({ text: buf });
      buf = "";
      out.push({ key: ch === "\n" ? "enter" : "tab" });
    } else buf += ch;
  }
  if (buf) out.push({ text: buf });
  return out;
}

// ---------- model context ----------

/**
 * Only the newest KEEP_SHOTS desktop screenshots stay in what the model sees; older ones
 * become a short text note (the images stay saved for the chat's audit trail). oovi never
 * replays thinking blocks, so dropping old images doesn't invalidate anything.
 */
export function pruneDesktopShots(history: Msg[], keep = KEEP_SHOTS): Msg[] {
  let seen = 0;
  const out = history.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]!;
    if (m.role !== "tool" || !m.results.some((r) => r.shot)) continue;
    const results = m.results
      .slice()
      .reverse()
      .map((r) => {
        if (!r.shot) return r;
        if (seen < keep) {
          seen++;
          return r;
        }
        const { shot: _drop, ...rest } = r;
        return { ...rest, content: `${r.content}\n(Older screenshot removed to save space.)` };
      })
      .reverse();
    out[i] = { role: "tool", results };
  }
  return out;
}

/** Whether a call needs the user's OK. granted: the user allowed desktop control for this task. first: the first desktop call of this turn. */
export function desktopNeedsOk(member: string, o: { granted: boolean; askEvery: boolean; first: boolean }): "grant" | "action" | null {
  if (!o.granted) return o.first ? "grant" : o.askEvery && !LOOK_ONLY.has(member) ? "action" : null;
  return o.askEvery && !LOOK_ONLY.has(member) ? "action" : null;
}

// ---------- a pointer the user can follow ----------

/**
 * The points the pointer passes through on its way (the last one is exactly `to`): it speeds up,
 * then slows down, so the user can follow it instead of seeing it jump. Longer ways take more steps,
 * up to 24 (about a third of a second).
 */
export function glidePath(from: Point, to: Point): Point[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (!Number.isFinite(dist) || dist < 4) return [{ x: Math.round(to.x), y: Math.round(to.y) }];
  const steps = Math.min(24, Math.max(4, Math.round(dist / 60)));
  const out: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in, ease out
    out.push({ x: Math.round(from.x + (to.x - from.x) * k), y: Math.round(from.y + (to.y - from.y) * k) });
  }
  out[out.length - 1] = { x: Math.round(to.x), y: Math.round(to.y) };
  return out;
}

// ---------- manage_window: the windows open on the user's computer ----------

const normWin = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export type AppWindow = WinInfo & { minimized?: boolean; maximized?: boolean };
export const WINDOW_ACTIONS = ["list", "switch", "minimize", "maximize", "restore", "close"] as const;
export type WindowAction = (typeof WINDOW_ACTIONS)[number];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const appName = (w: AppWindow) => (w.exe || "").replace(/\.exe$/i, "");

/**
 * The list the bot sees: numbered, top of the screen first. oovi's own windows are left out; private
 * windows (passwords, banking, security) are listed without their title, and can't be acted on.
 */
export function windowLines(list: AppWindow[]): { lines: string[]; shown: AppWindow[] } {
  const shown = list.filter((w) => !w.own && !w.overlay);
  const lines = shown.map((w, i) => {
    const v = windowVerdict(w);
    const state = w.minimized ? " (minimized)" : w.maximized ? " (maximized)" : "";
    if (v && (v.reason === "password" || v.reason === "security" || v.reason === "money")) return `${i + 1}. (a private window oovi doesn't touch)${state}`;
    if (v) return `${i + 1}. ${w.title} — ${appName(w)}${state} (oovi doesn't act on this one: ${v.reason === "system" ? "it can run programs or change the system" : v.reason === "elevated" ? "it runs as administrator" : "unknown window"})`;
    return `${i + 1}. ${w.title} — ${appName(w)}${state}${i === 0 && !w.minimized ? " (in front)" : ""}`;
  });
  return { lines, shown };
}

/** The window meant by a number from the latest list, or by words of its title or app name. */
export function pickWindow(list: AppWindow[], wanted: unknown): { win: AppWindow } | { error: string } {
  const { shown } = windowLines(list);
  if (!shown.length) return { error: "No windows are open (other than oovi's own)." };
  const raw = String(wanted ?? "").trim();
  if (!raw) return { error: "Say which window: its number from manage_window list, or words of its title." };
  if (/^\d{1,3}$/.test(raw)) {
    const w = shown[Number(raw) - 1];
    return w ? { win: w } : { error: `There is no window ${raw}: the list has ${shown.length}. Call manage_window list again (it changes as windows open and close).` };
  }
  const q = normWin(raw);
  const hits = shown.filter((w) => {
    const t = normWin(`${w.title} ${appName(w)}`);
    return q.split(" ").every((part) => t.includes(part));
  });
  if (hits.length === 1) return { win: hits[0]! };
  if (!hits.length) return { error: `No open window matches "${raw}". Open windows: ${windowLines(list).lines.join("; ") || "none"}.` };
  // Several windows of one app (two Chrome windows): the one nearest the front.
  const apps = new Set(hits.map(appName));
  if (apps.size === 1) return { win: hits[0]! };
  return { error: `Several windows match "${raw}": ${hits.slice(0, 6).map((w) => `${shown.indexOf(w) + 1}. ${w.title}`).join("; ")}. Give the number.` };
}

/** Whether oovi may act on this window (never its own, system, administrator or private windows). */
export function mayAct(w: AppWindow): string | null {
  const v = windowVerdict(w);
  return v ? v.message : null;
}
