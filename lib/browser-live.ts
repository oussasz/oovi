// Live view of a bot's browser, and letting the user take it over (sign-ins, CAPTCHAs).
//
// - Frames come from the Chrome DevTools Protocol screencast on the bot's own Playwright
//   page (local headless, Docker and the shared signed-in profile all speak it). Without
//   CDP we fall back to a JPEG screenshot every 500 ms. One screencast per session, shared
//   by every viewer, stopped when the last viewer leaves. Frames live in memory only.
// - Control: while the user has control, the bot is paused (tools wait in
//   waitWhileControlled) and nothing from the page reaches the model. Input from the user
//   is only accepted while they have control, validated, clamped and rate-limited.
//   Keystrokes and typed text are never logged or stored.
//
// State sits on globalThis so it survives dev hot reloads.

import type { CDPSession, Page } from "playwright-core";
import { peekSession } from "./browser";
import { getChat } from "./store";

export type TakeoverRequest = { reason: string; at: number };
export type LiveMeta = { url: string; title: string; controlled: boolean; request?: TakeoverRequest };
export type LiveMsg =
  | ({ type: "frame"; data: string; w: number; h: number } & LiveMeta)
  | ({ type: "state" } & LiveMeta)
  | { type: "end" };

export type Viewer = {
  /** Frames may be dropped by a slow viewer; the next one replaces them. */
  frame: (m: LiveMsg) => void;
  /** State changes are always delivered. */
  state: (m: LiveMsg) => void;
  end: () => void;
};

type Cast = { page: Page; cdp?: CDPSession; timer?: ReturnType<typeof setTimeout>; stopped: boolean };

type LiveState = {
  controlled: boolean;
  request?: TakeoverRequest;
  /** Control started / last input from the user (for the idle auto-release). */
  since: number;
  lastInput: number;
  /** The user touched the browser since the bot last looked: the next tool result says so. */
  usedByUser: boolean;
  viewers: Set<Viewer>;
  waiters: Set<() => void>;
  cast?: Cast;
  watch?: ReturnType<typeof setInterval>;
  /** Latest frame, in memory only, so a new viewer sees something right away. */
  frame?: { data: string; w: number; h: number };
  url: string;
  title: string;
  /** Input rate limit: events in the current one-second window. */
  rate: { start: number; count: number };
  /** Input runs one event at a time, in order. */
  chain: Promise<unknown>;
};

/** How long a bot waits for the user (to take over, or to hand back). */
export const WAIT_MS = 15 * 60_000;
/** Control is handed back automatically after this long without any input. */
const CONTROL_IDLE_MS = 15 * 60_000;
const MAX_EVENTS_PER_SEC = 60;
export const MAX_TEXT = 2000;
export const MAX_REASON = 200;
const FALLBACK_MS = 500;

const g = globalThis as typeof globalThis & { __ooviLive?: Map<string, LiveState>; __ooviLiveSweep?: ReturnType<typeof setInterval> };
const states = (g.__ooviLive ??= new Map<string, LiveState>());

function stateOf(id: string): LiveState {
  let st = states.get(id);
  if (!st) {
    st = { controlled: false, since: 0, lastInput: 0, usedByUser: false, viewers: new Set(), waiters: new Set(), url: "", title: "", rate: { start: 0, count: 0 }, chain: Promise.resolve() };
    states.set(id, st);
  }
  return st;
}

if (!g.__ooviLiveSweep) {
  g.__ooviLiveSweep = setInterval(() => {
    const now = Date.now();
    for (const [id, st] of states) {
      const sess = peekSession(id);
      if (!sess) {
        // The browser closed: nothing left to control.
        if (st.controlled || st.request) {
          st.controlled = false;
          st.request = undefined;
          notify(id, st);
        }
        if (!st.viewers.size && !st.waiters.size) states.delete(id);
        continue;
      }
      if (st.controlled && now - Math.max(st.since, st.lastInput) > CONTROL_IDLE_MS) {
        st.controlled = false;
        notify(id, st);
      }
      // Keep the browser open while the user is using it or a bot is waiting for them.
      if (st.controlled || st.request) sess.lastUsed = now;
    }
  }, 30_000);
  g.__ooviLiveSweep.unref?.();
}

// ---------- meta & broadcasting ----------

function metaOf(id: string, st: LiveState): LiveMeta {
  const sess = peekSession(id);
  let url = st.url;
  try {
    if (sess && !sess.page.isClosed()) url = sess.page.url();
  } catch {
    /* page gone */
  }
  st.url = url;
  return { url, title: st.title, controlled: st.controlled, ...(st.request ? { request: st.request } : {}) };
}

function notify(id: string, st: LiveState) {
  const m: LiveMsg = { type: "state", ...metaOf(id, st) };
  for (const v of st.viewers) v.state(m);
  for (const w of [...st.waiters]) w();
}

function emitFrame(id: string, st: LiveState, data: string, w: number, h: number) {
  st.frame = { data, w, h };
  const m: LiveMsg = { type: "frame", data, w, h, ...metaOf(id, st) };
  for (const v of st.viewers) v.frame(m);
}

// ---------- screencast ----------

async function viewportOf(page: Page, st: LiveState): Promise<{ width: number; height: number }> {
  const vp = page.viewportSize();
  if (vp) return vp;
  if (st.frame) return { width: st.frame.w, height: st.frame.h };
  return page.evaluate("({ width: window.innerWidth, height: window.innerHeight })") as Promise<{ width: number; height: number }>;
}

async function shotFrame(id: string, st: LiveState, page: Page): Promise<string | null> {
  const buf = await page.screenshot({ type: "jpeg", quality: 60, timeout: 3_000 });
  const vp = await viewportOf(page, st);
  const data = buf.toString("base64");
  emitFrame(id, st, data, vp.width, vp.height);
  return data;
}

function startFallback(id: string, st: LiveState, cast: Cast) {
  let last = "";
  const tick = async () => {
    if (cast.stopped) return;
    try {
      const buf = await cast.page.screenshot({ type: "jpeg", quality: 60, timeout: 3_000 });
      const data = buf.toString("base64");
      if (data !== last && !cast.stopped) {
        last = data;
        const vp = await viewportOf(cast.page, st);
        emitFrame(id, st, data, vp.width, vp.height);
      }
    } catch {
      /* page busy or navigating; try again */
    }
    if (!cast.stopped) cast.timer = setTimeout(() => void tick(), FALLBACK_MS);
  };
  void tick();
}

async function startCast(id: string, st: LiveState) {
  const sess = peekSession(id);
  if (!sess || sess.page.isClosed()) return;
  const page = sess.page;
  const cast: Cast = { page, stopped: false };
  st.cast = cast;
  try {
    const cdp = await sess.context.newCDPSession(page);
    if (cast.stopped) {
      await cdp.detach().catch(() => {});
      return;
    }
    cast.cdp = cdp;
    let got = false;
    cdp.on("Page.screencastFrame", (f) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      if (cast.stopped) return;
      got = true;
      const w = Math.round(f.metadata.deviceWidth) || page.viewportSize()?.width || 1280;
      const h = Math.round(f.metadata.deviceHeight) || page.viewportSize()?.height || 800;
      emitFrame(id, st, f.data, w, h);
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
    // A page that never repaints sends no frame: seed one so the viewer isn't blank.
    cast.timer = setTimeout(() => {
      if (!got && !cast.stopped) void shotFrame(id, st, page).catch(() => {});
    }, 1_500);
  } catch {
    if (cast.stopped) return;
    cast.cdp = undefined;
    startFallback(id, st, cast);
  }
}

function stopCast(st: LiveState) {
  const cast = st.cast;
  st.cast = undefined;
  if (!cast) return;
  cast.stopped = true;
  if (cast.timer) clearTimeout(cast.timer);
  const cdp = cast.cdp;
  if (cdp) void cdp.send("Page.stopScreencast").catch(() => {}).finally(() => void cdp.detach().catch(() => {}));
}

/** Once a second: follow pop-ups (sess.page changes), notice the browser closing, refresh the title. */
function watch(id: string, st: LiveState) {
  let busy = false;
  st.watch = setInterval(() => {
    const sess = peekSession(id);
    if (!sess) {
      for (const v of [...st.viewers]) v.end();
      return;
    }
    if (!st.cast || st.cast.page !== sess.page || st.cast.page.isClosed()) {
      stopCast(st);
      void startCast(id, st);
    }
    if (busy || sess.page.isClosed()) return;
    busy = true;
    const before = `${st.url}\n${st.title}`;
    void Promise.race([sess.page.title(), new Promise<string>((r) => setTimeout(() => r(st.title), 1_000))])
      .then((title) => {
        st.title = title.slice(0, 300);
        metaOf(id, st);
        if (`${st.url}\n${st.title}` !== before) notify(id, st);
      })
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  }, 1_000);
  st.watch.unref?.();
}

/** Start sending frames to a viewer. Returns the function that stops it. */
export function addViewer(id: string, v: Viewer): () => void {
  const st = stateOf(id);
  st.viewers.add(v);
  v.state({ type: "state", ...metaOf(id, st) });
  if (st.viewers.size === 1) {
    watch(id, st);
    void startCast(id, st);
  } else if (st.frame) {
    v.frame({ type: "frame", ...st.frame, ...metaOf(id, st) });
  }
  return () => {
    if (!st.viewers.delete(v) || st.viewers.size) return;
    if (st.watch) clearInterval(st.watch);
    st.watch = undefined;
    stopCast(st);
    st.frame = undefined;
  };
}

// ---------- control ----------

export function liveInfo(id: string): { controlled: boolean; request?: TakeoverRequest } {
  const st = states.get(id);
  return { controlled: !!st?.controlled, ...(st?.request ? { request: st.request } : {}) };
}

export const isControlled = (id: string) => !!states.get(id)?.controlled;

export function takeControl(id: string): boolean {
  if (!peekSession(id)) return false;
  const st = stateOf(id);
  const now = Date.now();
  st.controlled = true;
  st.since = now;
  st.lastInput = now;
  st.request = undefined;
  st.usedByUser = true;
  notify(id, st);
  return true;
}

export function releaseControl(id: string): void {
  const st = states.get(id);
  if (!st?.controlled) return;
  st.controlled = false;
  notify(id, st);
}

/** True once after the user used this browser (and clears it). */
export function consumeUserUse(id: string): boolean {
  const st = states.get(id);
  if (!st?.usedByUser) return false;
  st.usedByUser = false;
  return true;
}

export type WaitResult = "ok" | "aborted" | "timeout" | "closed";

function waitFor(id: string, done: (st: LiveState) => boolean, signal: AbortSignal | undefined, ms: number): Promise<WaitResult> {
  const st = stateOf(id);
  return new Promise<WaitResult>((resolve) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const finish = (r: WaitResult) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      st.waiters.delete(check);
      signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };
    const check = () => {
      if (done(st)) return finish("ok");
      if (!peekSession(id)) finish("closed");
    };
    const onAbort = () => finish("aborted");
    if (signal?.aborted) return finish("aborted");
    signal?.addEventListener("abort", onAbort);
    st.waiters.add(check);
    poll = setInterval(check, 1_000);
    timer = setTimeout(() => finish("timeout"), ms);
    check();
  });
}

/** Resolves right away unless the user has control; then waits until they hand back. */
export function waitWhileControlled(id: string, signal?: AbortSignal, ms = WAIT_MS): Promise<WaitResult> {
  if (!isControlled(id)) return Promise.resolve("ok");
  return waitFor(id, (st) => !st.controlled, signal, ms);
}

export type TakeoverResult = "done" | "aborted" | "timeout" | "closed";

/** The bot asks the user to take over; resolves after they took control and handed it back. */
export async function requestTakeover(id: string, reason: string, signal?: AbortSignal): Promise<TakeoverResult> {
  const st = stateOf(id);
  const req: TakeoverRequest = { reason: cleanText(reason, MAX_REASON) || "Sign in or finish a check on this page", at: Date.now() };
  if (!st.controlled) {
    st.request = req;
    notify(id, st);
    const taken = await waitFor(id, (s) => s.controlled, signal, WAIT_MS);
    if (taken !== "ok") {
      if (st.request === req) {
        st.request = undefined;
        notify(id, st);
      }
      return taken;
    }
  }
  // Auto-release after CONTROL_IDLE_MS of no input bounds this wait too.
  const back = await waitFor(id, (s) => !s.controlled, signal, WAIT_MS + CONTROL_IDLE_MS);
  return back === "ok" ? "done" : back;
}

// ---------- input ----------

export type LiveInput =
  | { type: "mouse"; action: "down" | "up" | "move"; x: number; y: number; button: "left" | "right" | "middle"; clickCount: number }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string };

const NAMED_KEYS = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);
const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** Playwright key names like "Enter", "Shift+Tab", "Control+A". Anything else is refused. */
export function validKey(k: unknown): string | null {
  if (typeof k !== "string" || !k || k.length > 40) return null;
  const parts = k.split("+");
  // "Control++" means Control and the plus key.
  if (k.endsWith("++")) parts.splice(parts.length - 2, 2, "+");
  const key = parts.pop() ?? "";
  if (parts.length > 3 || new Set(parts).size !== parts.length || !parts.every((p) => MODIFIERS.has(p))) return null;
  if (NAMED_KEYS.has(key)) return k;
  const chars = [...key];
  if (chars.length === 1 && !/[\u0000-\u001f\u007f]/.test(key)) return k;
  return null;
}

const clamp = (n: unknown, lo: number, hi: number): number | null => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null);

/** Strip control characters (keep newlines and tabs in text) and cap the length. */
export function cleanText(s: unknown, max: number, keepLines = false): string {
  if (typeof s !== "string") return "";
  const out = keepLines ? s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "") : s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return [...out].slice(0, max).join("");
}

export function parseInput(raw: unknown): LiveInput | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (e.type === "mouse") {
    const x = clamp(e.x, 0, 1);
    const y = clamp(e.y, 0, 1);
    if (x === null || y === null || (e.action !== "down" && e.action !== "up" && e.action !== "move")) return null;
    const button = e.button === "right" || e.button === "middle" ? e.button : "left";
    return { type: "mouse", action: e.action, x, y, button, clickCount: Math.round(clamp(e.clickCount, 1, 3) ?? 1) };
  }
  if (e.type === "wheel") {
    const x = clamp(e.x, 0, 1);
    const y = clamp(e.y, 0, 1);
    const dx = clamp(e.dx, -3000, 3000);
    const dy = clamp(e.dy, -3000, 3000);
    if (x === null || y === null || dx === null || dy === null) return null;
    return { type: "wheel", x, y, dx, dy };
  }
  if (e.type === "key") {
    const key = validKey(e.key);
    return key ? { type: "key", key } : null;
  }
  if (e.type === "text") {
    if (typeof e.text !== "string" || [...e.text].length > MAX_TEXT) return null;
    const text = cleanText(e.text, MAX_TEXT, true);
    return text ? { type: "text", text } : null;
  }
  return null;
}

export type InputOutcome = { ok: true } | { ok: false; status: number; error: string };

async function apply(page: Page, st: LiveState, ev: LiveInput) {
  if (ev.type === "key") return page.keyboard.press(ev.key);
  if (ev.type === "text") {
    // Short plain text gets real key events (some sign-in and code fields listen for them);
    // anything else (other alphabets, IME results, pastes) is inserted as-is.
    if (ev.text.length <= 32 && /^[\x20-\x7e]+$/.test(ev.text)) return page.keyboard.type(ev.text);
    return page.keyboard.insertText(ev.text);
  }
  const vp = await viewportOf(page, st);
  const x = ev.x * vp.width;
  const y = ev.y * vp.height;
  await page.mouse.move(x, y);
  if (ev.type === "wheel") return page.mouse.wheel(ev.dx, ev.dy);
  if (ev.action === "down") return page.mouse.down({ button: ev.button, clickCount: ev.clickCount });
  if (ev.action === "up") return page.mouse.up({ button: ev.button, clickCount: ev.clickCount });
}

/** Run the user's input on the bot's page. Only while the user has control. */
export async function sendInput(id: string, events: LiveInput[]): Promise<InputOutcome> {
  const st = states.get(id);
  const sess = peekSession(id);
  if (!sess || sess.page.isClosed()) return { ok: false, status: 404, error: "The browser is closed." };
  if (!st?.controlled) return { ok: false, status: 409, error: "Take control first." };
  const now = Date.now();
  if (now - st.rate.start >= 1_000) st.rate = { start: now, count: 0 };
  if (st.rate.count + events.length > MAX_EVENTS_PER_SEC) return { ok: false, status: 429, error: "Too much input at once." };
  st.rate.count += events.length;
  st.lastInput = now;
  sess.lastUsed = now;
  const page = sess.page;
  const run = st.chain.then(async () => {
    for (const ev of events) {
      if (!st.controlled || page.isClosed()) break;
      // The page may be navigating; a lost event is better than a stuck queue.
      await Promise.race([apply(page, st, ev), new Promise((r) => setTimeout(r, 5_000))]).catch(() => {});
    }
  });
  st.chain = run.catch(() => {});
  await run.catch(() => {});
  return { ok: true };
}

// ---------- API helpers ----------

/** For the API routes: the chat must exist and the bot must be in it. */
export function liveTarget(chatId: unknown, botId: unknown): { sessionId: string } | Response {
  if (typeof chatId !== "string" || typeof botId !== "string" || !/^[\w-]{1,80}$/.test(botId)) return Response.json({ error: "Missing chat or bot." }, { status: 400 });
  const chat = getChat(chatId);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  if (!chat.memberIds.includes(botId)) return Response.json({ error: "That bot isn't in this chat." }, { status: 404 });
  return { sessionId: `${chatId}_${botId}` };
}

export type LiveSessionInfo = { botId: string; url: string; title: string; controlled: boolean; request?: TakeoverRequest };

/** The open bot browsers of one chat. */
export async function chatSessions(chatId: string, memberIds: string[]): Promise<LiveSessionInfo[]> {
  const out: LiveSessionInfo[] = [];
  for (const botId of memberIds) {
    const id = `${chatId}_${botId}`;
    const sess = peekSession(id);
    if (!sess || sess.page.isClosed()) continue;
    const st = states.get(id);
    let title = st?.title ?? "";
    if (!st?.viewers.size) title = await Promise.race([sess.page.title().catch(() => ""), new Promise<string>((r) => setTimeout(() => r(""), 800))]);
    out.push({ botId, url: sess.page.url(), title: title.slice(0, 300), ...liveInfo(id) });
  }
  return out;
}
