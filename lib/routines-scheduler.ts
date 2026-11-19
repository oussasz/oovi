// The routines loop: started once from instrumentation.ts, it looks at every routine
// every 30 seconds (and right after start or wake-up), fires the ones that are due in
// their own chat, and reports results (desktop notification, Telegram if asked).
//
// Unattended runs never approve anything: a tool that needs the user's OK pauses the run
// as usual, the routine shows "waiting" and the user is told. When they answer later, the
// next tick picks up the result. The decisions themselves are pure (routines-schedule.ts).

import fs from "node:fs";
import { currentSession } from "./account";
import type { TKey, Vars } from "./i18n";
import { translateFor } from "./i18n-server";
import { getRoutine, listRoutines, mutateRoutine, routineChat } from "./routines";
import { afterRun, CREDIT_CODES, decideTick, MAX_FAILURES, nextRun, resultOf, type ChatState, type RunResult } from "./routines-schedule";
import { checkUrl } from "./browser";
import { spentSince } from "./orchestrator";
import { isRunning, startRun, subscribe, whenIdle } from "./runner";
import { collectHookEvents, hookCursor, hookNote, setHookCursor } from "./routine-hooks";
import { hashText, isNoNews, pageText, QUIET_NOTE, significant, watchNote } from "./watch-core";
import { loadSettings } from "./settings";
import { getBot, getChat, newId, saveChat } from "./store";
import { sendFileToTelegram, sendToMainChat } from "./telegram";
import type { BotEntry, Chat, Routine } from "./types";

const TICK_MS = 30_000;
/** Telegram gets the whole result (long text is sent in several messages); past this, the rest stays in oovi. */
const TELEGRAM_MAX = 12_000;
const DESKTOP_MAX = 240;

type Active = { chatId: string; startedAt: number; entryId?: string };
type State = { timer?: ReturnType<typeof setInterval>; ticking: boolean; cloudChecked?: boolean; busySince: Map<string, number>; active: Map<string, Active>; watching: Set<string> };

const g = globalThis as typeof globalThis & {
  __ooviRoutines?: State;
  /** Set by electron/main.cjs before the server starts (absent in `npm run web`). */
  __ooviDesktop?: { notify?: (title: string, body: string, chatId?: string) => void };
  /** Called by electron/main.cjs when the computer wakes up. */
  __ooviRoutinesWake?: () => void;
};

function state(): State {
  const s = (g.__ooviRoutines ??= { ticking: false, busySince: new Map(), active: new Map(), watching: new Set() });
  s.busySince ??= new Map();
  s.active ??= new Map();
  s.watching ??= new Set();
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
    // With cloud sync: first what the cloud server ran while this computer was off (marked done here, so the catch-up
    // below doesn't run it again), and this computer's next times for it (lib/cloud-sync.ts). A few seconds at most.
    const cloudRoutines = (g as typeof g & { __ooviCloudRoutines?: (force?: boolean) => Promise<void> }).__ooviCloudRoutines;
    if (cloudRoutines) {
      const first = !s.cloudChecked;
      await Promise.race([cloudRoutines(first).then(() => void (s.cloudChecked = true)).catch(() => {}), new Promise((r) => setTimeout(r, first ? 8000 : 4000))]);
    }
    const now = Date.now();
    for (const r of listRoutines()) {
      try {
        checkOne(r, now);
      } catch (e) {
        console.error(`[routines] ${r.id}:`, (e as Error).message);
      }
    }
    await pollHooks().catch((e) => console.error("[routines] web addresses:", (e as Error).message));
  } finally {
    s.ticking = false;
  }
}

function chatState(r: Routine, chat: Chat | null): ChatState {
  if (state().active.has(r.id) || isRunning(r.chatId)) return "busy";
  if (chat?.pending?.approval || chat?.pending?.planReview || chat?.pending?.questions) return "waiting";
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
  // Started by its web address only (pollHooks), never by the clock.
  if (r.schedule.kind === "webhook") return;
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
  } else if (r.watch) {
    // A watched page is read first (plain code, no AI): unchanged, the run is skipped for free.
    if (s.watching.has(r.id)) return;
    s.watching.add(r.id);
    void checkWatch(r)
      .then((w) => {
        if (w.kind === "same") {
          s.busySince.delete(r.id);
          mutateRoutine(r.id, (x) => {
            x.nextRunAt = d.next;
            if (x.watch) x.watch.checkedAt = Date.now();
            x.lastRun = { at: Date.now(), status: "skipped", note: "no change" };
            if (x.schedule.kind === "once") disableOnce(x);
          });
          return;
        }
        afterFire(r, d, fire(r, false, w.note));
      })
      .finally(() => s.watching.delete(r.id));
  } else {
    afterFire(r, d, fire(r, false));
  }
}

/** After a scheduled start: the next time, or a retry on the next tick when the chat became busy. */
function afterFire(r: Routine, d: { occurrence: number; next: number | null }, started: FireResult) {
  const s = state();
  const now = Date.now();
  {
    if (started === "started") {
      s.busySince.delete(r.id);
      mutateRoutine(r.id, (x) => {
        x.nextRunAt = d.next;
        // "Once" routines turn themselves off after their run.
        if (x.schedule.kind === "once") disableOnce(x);
      });
    } else if (started !== "bot") {
      // Became busy in between: try again next tick (this counts toward the 10-minute window).
      s.busySince.set(r.id, s.busySince.get(r.id) ?? now);
    }
  }
}

/**
 * Calls to the web addresses of the routines that run on this computer: each one starts its routine with
 * what was sent. A routine still busy keeps its calls for the next tick (nothing is lost or skipped).
 */
async function pollHooks() {
  const hooked = listRoutines().filter((r) => r.enabled && r.schedule.kind === "webhook" && r.hook);
  if (!hooked.length) return;
  const byHook = new Map(hooked.map((r) => [r.hook!.id, r]));
  let after = hookCursor();
  const events = await collectHookEvents([...byHook.keys()], after);
  for (const e of events) {
    const r = byHook.get(e.hookId);
    if (r) {
      const started = fire(r, false, hookNote(e));
      // Busy or waiting for an OK: try this call again on the next tick.
      if (started === "busy" || started === "waiting") break;
    }
    after = Math.max(after, e.id);
  }
  if (after !== hookCursor()) setHookCursor(after);
}

export type FireResult = "started" | "busy" | "waiting" | "bot" | "missing";

/**
 * Start a run of the routine in its chat. manual: the user pressed Run now (allowed even
 * within 15 minutes of the last run, but never while a run is going or waiting for an OK).
 */
function disableOnce(x: Routine) {
  x.enabled = false;
  x.nextRunAt = null;
  x.pausedReason = "done";
}

type Watched = { kind: "same" } | { kind: "changed"; note: string } | { kind: "error"; note: string };

/** Read the watched page with plain code and compare it with the last check. Saves what was seen. */
async function checkWatch(r: Routine): Promise<Watched> {
  const url = r.watch?.url ?? "";
  const blocked = checkUrl(url, loadSettings().browser.allowPrivateNetwork);
  if (blocked) return { kind: "error", note: `[oovi: the page to watch can't be read (${blocked}). Do the task anyway and say so.]` };
  let text: string;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 (oovi routine check)", accept: "text/html,application/xhtml+xml,application/xml,application/json,text/plain;q=0.9,*/*;q=0.5" } });
    if (!res.ok) return { kind: "error", note: `[oovi: the watched page answered ${res.status}: open it with your tools to check it.]` };
    text = significant(pageText(await res.text(), res.headers.get("content-type") ?? ""));
  } catch (e) {
    return { kind: "error", note: `[oovi: the watched page couldn't be read (${(e as Error).message.slice(0, 120)}): open it with your tools to check it.]` };
  }
  const hash = hashText(text);
  const before = r.watch?.hash ? r.watch.text : undefined;
  if (r.watch?.hash === hash) return { kind: "same" };
  mutateRoutine(r.id, (x) => {
    if (x.watch?.url === url) x.watch = { url, hash, text: text.slice(0, 20_000), checkedAt: Date.now() };
  });
  return { kind: "changed", note: watchNote(url, before, text) };
}

function fire(r: Routine, manual: boolean, note?: string): FireResult {
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
  // A plain reminder: its text is posted as it is, no AI run, no cost.
  if (r.remind) {
    remind(r);
    return "started";
  }
  const chat = routineChat(r);
  const cs = chatState(r, chat);
  if (cs !== "free") return manual ? cs : "busy";
  // Never auto-approve, never plan mode: just the instruction, marked as coming from the routine.
  // A quiet routine posts only when there's something new (lib/watch-core.ts NO_NEWS).
  const text = [r.prompt, note, r.quiet ? QUIET_NOTE : ""].filter(Boolean).join("\n\n");
  if (!startRun(chat.id, { text, routine: r.id })) return "busy";
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

/**
 * The cloud runner (lib/cloud-runner.ts): runs a routine that came due while the computer was off, now, in its chat,
 * with the same code as on the computer (reminders, results, Telegram). Resolves once the run is recorded, with how
 * it went and its next time (null: none, a "once" routine).
 */
export async function runRoutineInCloud(id: string): Promise<{ status: string; ranAt: number; next: number | null } | null> {
  const r = getRoutine(id);
  if (!r) return null;
  // Second guard (the website already keeps these for the computer): a watched page is compared with the copy kept
  // on the computer, and a web-address routine is started by the computer; neither runs here.
  if (r.watch || r.schedule.kind === "webhook") return { status: "needs_computer", ranAt: Date.now(), next: null };
  const ranAt = Date.now();
  const nextOf = () => (r.schedule.kind === "once" || r.schedule.kind === "webhook" ? null : nextRun(r.schedule, r.timezone, Date.now()));
  const started = fire(r, false);
  if (started !== "started") return { status: started === "bot" ? "error" : "busy", ranAt, next: started === "bot" ? null : nextOf() };
  // finish() records the run just after it ends (lib/routines-scheduler.ts fire): wait for both.
  for (let i = 0; i < 20 * 60 * 4 && state().active.has(id); i++) await new Promise((res) => setTimeout(res, 250));
  await new Promise((res) => setTimeout(res, 50));
  const after = getRoutine(id);
  return { status: after?.lastRun?.status ?? "ok", ranAt, next: nextOf() };
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
    // What this run cost, for the 3-times-usual cap of later runs (lib/spend-core.ts).
    const chat = entryId ? getChat(x.chatId) : null;
    if (res.status === "ok" && chat && entryId) x.runCosts = [...(x.runCosts ?? []), spentSince(chat, entryId)].slice(-5);
    x.lastRun = {
      at: Date.now(),
      status: res.status,
      ...(res.status !== "ok" && res.text ? { note: res.text.slice(0, 300) } : {}),
      ...(res.errorCode ? { code: res.errorCode.slice(0, 40) } : {}),
      ...(entryId ? { entryId } : {}),
    };
  });
  if (!r) return; // deleted meanwhile
  // Nothing new: recorded, nobody is told.
  if (res.status === "ok" && isNoNews(res.text)) {
    mutateRoutine(id, (x) => {
      if (x.lastRun) x.lastRun.note = "nothing new";
    });
    return;
  }
  if (res.status === "ok") {
    if (r.postTo && res.text) void postInChat(r.postTo, r.botId, `⏰ **${r.name}**\n\n${res.text}`);
    notifyResult(r, res.text);
    void telegramFiles(r);
  } else if (res.status === "error" && !toldBefore) notifyResult(r, translateFor("routines.n.failed", { name: r.name, error: res.text.slice(0, 600) }), true);
  else if (res.status === "waiting") notify(r, "routines.n.waiting", { name: r.name, what: res.text.slice(0, 600) }, "routines.n.waitingTg");
  if (paused) notify(r, "routines.n.paused", { name: r.name, count: MAX_FAILURES });
}

// ---------- telling the user ----------

/**
 * A message from the bot in a chat the user reads (the one they asked in), with no model call. A run holding that chat
 * would overwrite it, so it waits for the run to end (up to 10 minutes, then writes anyway after a re-read).
 */
export async function postInChat(chatId: string, botId: string, text: string): Promise<boolean> {
  if (isRunning(chatId)) await whenIdle(chatId, 10 * 60_000);
  const chat = getChat(chatId);
  if (!chat || isRunning(chatId)) return false;
  const entry: BotEntry = { id: newId(), kind: "bot", botId: chat.memberIds.includes(botId) ? botId : (chat.leadId ?? chat.memberIds[0] ?? botId), at: Date.now(), steps: [], text, status: "done", usage: { input: 0, output: 0 } };
  chat.entries.push(entry);
  saveChat(chat);
  return true;
}

/** A reminder is due: post it where it was asked, notify the desktop, and Telegram when asked from there. */
function remind(r: Routine) {
  const text = r.prompt.trim();
  mutateRoutine(r.id, (x) => {
    x.lastStartedAt = Date.now();
    x.lastRun = { at: Date.now(), status: "ok" };
    x.failures = 0;
  });
  const target = r.postTo && getChat(r.postTo) ? r.postTo : routineChat(r).id;
  void postInChat(target, r.botId, `⏰ ${text}`);
  desktop("⏰ oovi", text, target);
  if (r.notifyTelegram) void sendToMainChat(`⏰ ${text}`).catch(() => false);
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
  void sendToMainChat(text.slice(0, TELEGRAM_MAX + 400)).catch(() => false);
}

/** Files the routine's run made (a report, a spreadsheet) go to Telegram with its result. */
async function telegramFiles(r: Routine) {
  if (!r.notifyTelegram) return;
  try {
    const chat = getChat(r.chatId);
    if (!chat) return;
    let u = chat.entries.length - 1;
    while (u >= 0 && chat.entries[u]?.kind !== "user") u--;
    const files = new Map<string, { path: string; name: string; size: number }>();
    for (const e of chat.entries.slice(u + 1)) {
      if (e.kind !== "bot") continue;
      for (const st of e.steps) if (st.role === "tool") for (const x of st.results) if (x.file && !x.isError) files.set(x.file.path, x.file);
    }
    for (const f of [...files.values()].slice(0, 5)) {
      if (f.size > 50 * 1024 * 1024 || !fs.existsSync(f.path)) continue;
      await sendFileToTelegram({ name: f.name, data: fs.readFileSync(f.path) });
    }
  } catch (e) {
    console.error("[routines] telegram files:", (e as Error).message);
  }
}

/** A run's reply (or error, already worded). */
function notifyResult(r: Routine, text: string, isError = false) {
  const body = text || translateFor("routines.n.empty", { name: r.name });
  desktop(`⏰ ${r.name}`, body, r.chatId);
  const tg = body.length > TELEGRAM_MAX ? `${body.slice(0, TELEGRAM_MAX)}…\n(The full result is in oovi.)` : body;
  telegram(r, isError ? tg : `⏰ ${r.name}:\n${tg}`);
}

function notify(r: Routine, key: TKey, vars: Vars, telegramKey?: TKey) {
  desktop(`⏰ ${r.name}`, translateFor(key, vars), r.chatId);
  telegram(r, translateFor(telegramKey ?? key, vars));
}
