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

// ---------- protected windows ----------

const PASSWORD_MANAGERS = /\b(1password|bitwarden|keepass(xc)?|lastpass|dashlane|keeper( password| security)?|nordpass|proton pass|roboform|enpass)\b/i;
const WINDOWS_SECURITY = /\b(windows security|credential manager|enter (network )?credentials|user account control|windows hello|sécurité windows|windows-sicherheit|seguridad de windows|windows güvenliği|أمان windows)\b/i;
const MONEY =
  /\b(ban(k|ca|co|que)\w*|online.?banking|paypal|stripe|checkout|payment|paiement|zahlung|pago|ödeme|credit card|debit card|carte bancaire|kreditkarte|tarjeta|wallet|portefeuille|coinbase|binance|kraken|metamask|revolut|venmo|zelle|cash app|western union|moneygram)\b|بنك|مصرف|دفع/i;

/** Why a window is protected, or null. Matched on its title (oovi can't see process names). */
export function protectedWindow(title: string): "password" | "security" | "money" | null {
  const t = title.normalize("NFKC");
  if (PASSWORD_MANAGERS.test(t)) return "password";
  if (WINDOWS_SECURITY.test(t)) return "security";
  if (MONEY.test(t)) return "money";
  return null;
}

/** Elevated windows show "Administrator:" in their title (consoles, some tools): Windows blocks input to them. */
export const elevatedWindow = (title: string) => /^(administrator|administrateur|administrador|administrator in|yönetici|المسؤول)\s*:/i.test(title.trim());

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

/** Blocked even with approval: they'd hand the session to someone else or are meaningless to send. */
export function forbiddenCombo(c: KeyCombo): string | null {
  const m = new Set(c.modifiers);
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

export const MAX_TYPE = 4000;
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
    if (!m) return `"${p}" isn't a modifier key (use shift, ctrl, alt or super).`;
    if (!out.includes(m)) out.push(m);
  }
  return out;
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
      if (i.text.length > MAX_TYPE) return `text is too long (${i.text.length} characters; at most ${MAX_TYPE} per call).`;
      return { kind: "type", text: i.text };
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
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) return "repeat must be a whole number from 1 to 100.";
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

/** A short line for the approval card and the chat ("Click at (412, 230) in "Untitled - Notepad""). */
export function describeAction(a: DesktopAction, windowTitle: string): string {
  const where = windowTitle ? ` in "${windowTitle.slice(0, 80)}"` : "";
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
      return `${what}${at(a.at)}${mods(a.modifiers)}${where}`;
    }
    case "drag":
      return `Drag from (${a.from.x}, ${a.from.y}) to (${a.to.x}, ${a.to.y})${mods(a.modifiers)}${where}`;
    case "move":
      return `Move the pointer to (${a.at.x}, ${a.at.y})`;
    case "mouse_down":
      return `Press the mouse button${where}`;
    case "mouse_up":
      return `Release the mouse button${where}`;
    case "scroll":
      return `Scroll ${a.direction}${a.at ? ` at (${a.at.x}, ${a.at.y})` : ""}${where}`;
    case "type": {
      const t = a.text.replace(/\s+/g, " ");
      return `Type: ${t.length > 60 ? `${t.slice(0, 60)}…` : t}${where}`;
    }
    case "key":
      return `Press ${a.combos.map(comboLabel).join(", ")}${a.repeat > 1 ? ` ×${a.repeat}` : ""}${where}`;
    case "hold_key":
      return `Hold ${comboLabel(a.combo)} for ${a.seconds} s${where}`;
  }
}

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
