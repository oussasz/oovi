// The routines loop: started once from instrumentation.ts, it looks at every routine
// every 30 seconds (and right after start or wake-up), fires the ones that are due in
// their own chat, and reports results (desktop notification, Telegram if asked).
//
// Unattended runs never approve anything: a tool that needs the user's OK pauses the run
// as usual, the routine shows "waiting" and the user is told. When they answer later, the
// next tick picks up the result. The decisions themselves are pure (routines-schedule.ts).

import { currentSession } from "./account";
import { intlTag, resolveLocale, translate, type TKey, type Vars } from "./i18n";
import { getRoutine, listRoutines, mutateRoutine, routineChat } from "./routines";
import { afterRun, CREDIT_CODES, decideTick, MAX_FAILURES, nextRun, resultOf, type ChatState, type RunResult } from "./routines-schedule";
import { isRunning, startRun, subscribe } from "./runner";
import { loadSettings } from "./settings";
import { getBot, getChat } from "./store";
import { sendToMainChat } from "./telegram";
import type { Chat, Routine } from "./types";

const TICK_MS = 30_000;
const TELEGRAM_MAX = 3500;
const DESKTOP_MAX = 240;

type Active = { chatId: string; startedAt: number; entryId?: string };
type State = { timer?: ReturnType<typeof setInterval>; ticking: boolean; busySince: Map<string, number>; active: Map<string, Active> };

const g = globalThis as typeof globalThis & {
  __ooviRoutines?: State;
  /** Set by electron/main.cjs before the server starts (absent in `npm run web`). */
  __ooviDesktop?: { notify?: (title: string, body: string, chatId?: string) => void };
  /** Called by electron/main.cjs when the computer wakes up. */
  __ooviRoutinesWake?: () => void;
};

function state(): State {
  const s = (g.__ooviRoutines ??= { ticking: false, busySince: new Map(), active: new Map() });
  s.busySince ??= new Map();
  s.active ??= new Map();
  return s;
}

/** Start (or restart, after a hot reload) the loop. Safe to call many times. */
export function startRoutines(): void {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  s.timer = setInterval(() => void tick(), TICK_MS);
  s.timer.unref?.();
  g.__ooviRoutinesWake = () => void tick();
  // Shortly after start: catch up on anything missed while oovi was closed.
  setTimeout(() => void tick(), 3_000).unref?.();
}

async function tick(): Promise<void> {
  const s = state();
  if (s.ticking) return;
  s.ticking = true;
  try {
    // Routines belong to the signed-in account; nothing runs while signed out.
    if (!currentSession()) return;
    const now = Date.now();
    for (const r of listRoutines()) {
      try {
        checkOne(r, now);
      } catch (e) {
        console.error(`[routines] ${r.id}:`, (e as Error).message);
      }
    }
  } finally {
    s.ticking = false;
  }
}

function chatState(r: Routine, chat: Chat | null): ChatState {
  if (state().active.has(r.id) || isRunning(r.chatId)) return "busy";
  if (chat?.pending?.approval || chat?.pending?.planReview) return "waiting";
  return "free";
}

function checkOne(r: Routine, now: number) {
  const s = state();
  // A run that waited for the user's OK: report how it ended once they've answered.
  if (r.lastRun?.status === "waiting" && r.lastRun.entryId && !s.active.has(r.id) && !isRunning(r.chatId)) {
    const chat = getChat(r.chatId);
    if (chat) {
      const res = resultOf(chat, r.lastRun.entryId);
      if (res.status !== "waiting") finish(r.id, res, r.lastRun.entryId);
    }
  }
  if (!r.enabled) {
    s.busySince.delete(r.id);
    return;
  }
  if (r.nextRunAt === null) {
    mutateRoutine(r.id, (x) => {
      x.nextRunAt = nextRun(x.schedule, x.timezone, now);
    });
    return;
  }
  if (now < r.nextRunAt) return;
  const d = decideTick(r.schedule, r.timezone, { nextRunAt: r.nextRunAt, lastStartedAt: r.lastStartedAt, busySince: s.busySince.get(r.id) }, now, chatState(r, getChat(r.chatId)));
  if (d.kind === "idle") {
    s.busySince.delete(r.id);
  } else if (d.kind === "wait") {
    s.busySince.set(r.id, d.busySince);
  } else if (d.kind === "skip") {
    s.busySince.delete(r.id);
    mutateRoutine(r.id, (x) => {
      x.nextRunAt = d.next;
      // Skipped because it just ran (e.g. Run now a minute before): keep that run's result.
      if (d.note !== "recent") x.lastRun = { at: d.occurrence, status: d.status, note: d.note };
    });
  } else {
    const started = fire(r, false);
    if (started === "started") {
      s.busySince.delete(r.id);
      mutateRoutine(r.id, (x) => {
        x.nextRunAt = d.next;
      });
    } else if (started !== "bot") {
      // Became busy in between: try again next tick (this counts toward the 10-minute window).
      s.busySince.set(r.id, s.busySince.get(r.id) ?? now);
    }
  }
}

export type FireResult = "started" | "busy" | "waiting" | "bot" | "missing";

/**
 * Start a run of the routine in its chat. manual: the user pressed Run now (allowed even
 * within 15 minutes of the last run, but never while a run is going or waiting for an OK).
 */
function fire(r: Routine, manual: boolean): FireResult {
  const s = state();
  if (s.active.has(r.id)) return "busy";
  if (!getBot(r.botId)) {
    const paused = mutateRoutine(r.id, (x) => {
      x.enabled = false;
      x.nextRunAt = null;
      x.pausedReason = "bot";
      x.lastRun = { at: Date.now(), status: "error", note: "The bot that ran this routine was deleted." };
    });
    if (paused) notify(paused, "routines.n.botGone", { name: paused.name });
    return "bot";
  }
  const chat = routineChat(r);
  const cs = chatState(r, chat);
  if (cs !== "free") return manual ? cs : "busy";
  // Never auto-approve, never plan mode: just the instruction, marked as coming from the routine.
  if (!startRun(chat.id, { text: r.prompt, routine: r.id })) return "busy";
  const run: Active = { chatId: chat.id, startedAt: Date.now() };
  s.active.set(r.id, run);
  mutateRoutine(r.id, (x) => {
    x.lastStartedAt = run.startedAt;
  });
  const unsub = subscribe(chat.id, (e) => {
    if (e.type === "entry" && e.entry.kind === "user" && e.entry.routine === r.id && !run.entryId) run.entryId = e.entry.id;
    if (e.type !== "done") return;
    unsub?.();
    s.active.delete(r.id);
    // The run saves its chat as it ends; read it after that.
    setTimeout(() => {
      const after = getChat(chat.id);
      const res: RunResult = after && run.entryId ? resultOf(after, run.entryId) : { status: "error", text: "The run didn't start." };
      finish(r.id, res, run.entryId);
    }, 0);
  });
  if (!unsub) {
    // Ended before we could listen (shouldn't happen: runs always await before their first event).
    s.active.delete(r.id);
  }
  return "started";
}

/** Run a routine now (the Run now button). */
export function runRoutineNow(id: string): FireResult {
  const r = getRoutine(id);
  if (!r) return "missing";
  return fire(r, true);
}

/** Record a finished (or paused-for-approval) run and tell the user. */
function finish(id: string, res: RunResult, entryId?: string) {
  let paused = false;
  // Out of theOovi credits (or at the daily limit): recorded and told once, never retried. It
  // doesn't count toward the automatic pause, so the routine carries on once credits are back.
  const credit = res.status === "error" && !!res.errorCode && CREDIT_CODES.has(res.errorCode);
  let toldBefore = false;
  const r = mutateRoutine(id, (x) => {
    toldBefore = credit && x.lastRun?.status === "error" && x.lastRun.code === res.errorCode;
    if (res.status === "ok" || (res.status === "error" && !credit)) {
      const a = afterRun(x.failures, res.status);
      x.failures = a.failures;
      if (a.pause && x.enabled) {
        x.enabled = false;
        x.nextRunAt = null;
        x.pausedReason = "failures";
        paused = true;
      }
    }
    x.lastRun = {
      at: Date.now(),
      status: res.status,
      ...(res.status !== "ok" && res.text ? { note: res.text.slice(0, 300) } : {}),
      ...(res.errorCode ? { code: res.errorCode.slice(0, 40) } : {}),
      ...(entryId ? { entryId } : {}),
    };
  });
  if (!r) return; // deleted meanwhile
  if (res.status === "ok") notifyResult(r, res.text);
  else if (res.status === "error" && !toldBefore) notifyResult(r, translateFor("routines.n.failed", { name: r.name, error: res.text.slice(0, 600) }), true);
  else if (res.status === "waiting") notify(r, "routines.n.waiting", { name: r.name, what: res.text.slice(0, 600) }, "routines.n.waitingTg");
  if (paused) notify(r, "routines.n.paused", { name: r.name, count: MAX_FAILURES });
}

// ---------- telling the user ----------

/** Notifications use the app's UI language (Settings > Language, "auto" = this computer's). */
function translateFor(key: TKey, vars: Vars): string {
  let system: string[] = [];
  try {
    system = [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    system = [];
  }
  let setting = "auto";
  try {
    setting = loadSettings().language || "auto";
  } catch {
    setting = "auto";
  }
  const locale = resolveLocale(setting, system);
  return translate(locale, key, vars, intlTag(locale, system));
}

function desktop(title: string, body: string, chatId?: string) {
  try {
    g.__ooviDesktop?.notify?.(title, body.replace(/\s+/g, " ").trim().slice(0, DESKTOP_MAX), chatId);
  } catch {
    /* notifications are a bonus */
  }
}

function telegram(r: Routine, text: string) {
  if (!r.notifyTelegram) return;
  void sendToMainChat(text.slice(0, TELEGRAM_MAX + 200)).catch(() => false);
}

/** A run's reply (or error, already worded). */
function notifyResult(r: Routine, text: string, isError = false) {
  const body = text || translateFor("routines.n.empty", { name: r.name });
  desktop(`⏰ ${r.name}`, body, r.chatId);
  const tg = body.length > TELEGRAM_MAX ? `${body.slice(0, TELEGRAM_MAX)}…` : body;
  telegram(r, isError ? tg : `⏰ ${r.name}:\n${tg}`);
}

function notify(r: Routine, key: TKey, vars: Vars, telegramKey?: TKey) {
  desktop(`⏰ ${r.name}`, translateFor(key, vars), r.chatId);
  telegram(r, translateFor(telegramKey ?? key, vars));
}
