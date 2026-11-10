// Routines: the pure part. Schedule validation and math, what the scheduler does on
// each tick, and how a finished run is read back from its chat. No I/O here, so it
// can be tested on its own (and the server loop in routines-scheduler.ts stays thin).
//
// Next-run times come from croner, in the routine's own time zone. Every schedule is
// built from "fixed-time" cron patterns (one hour and one minute each), because croner
// gives those the DST behaviour people expect:
//   - a time inside the spring-forward gap (02:30 when clocks jump 02:00 -> 03:00) runs
//     once, at the first valid time after the gap (03:00);
//   - a time that happens twice (fall back) runs once, at its first occurrence.
// "Every N hours" is the union of such slots (from, from+N, … within a day), so it follows
// the same rules and never runs twice in a repeated hour.

import { Cron } from "croner";
import type { BotEntry, Chat, RoutineRunStatus, RoutineSchedule } from "./types";

export const MAX_ROUTINES = 50;
export const NAME_MAX = 60;
export const PROMPT_MAX = 4000;
/** A missed time is still run when oovi comes back within this long. */
export const CATCH_UP_MS = 12 * 60 * 60 * 1000;
/** A busy chat is retried on every tick for this long, then the time is skipped. */
export const BUSY_RETRY_MS = 10 * 60 * 1000;
/** At most one scheduled run per routine in this window, whatever the schedule says. */
export const MIN_GAP_MS = 15 * 60 * 1000;
/** Consecutive failures that pause a routine. */
export const MAX_FAILURES = 3;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,3}$/;

export const isTime = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v);

/** A real IANA time zone this runtime knows ("Europe/Paris", "UTC"). */
export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 64 || !TZ_RE.test(v)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** This machine's time zone (falls back to UTC). */
export function localTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(tz) ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

/** A clean schedule, or an error message for the user. */
export function validateSchedule(input: unknown): RoutineSchedule | string {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (o.kind === "daily") {
    if (!isTime(o.time)) return "Pick a time (HH:MM).";
    return { kind: "daily", time: o.time };
  }
  if (o.kind === "weekly") {
    if (!isTime(o.time)) return "Pick a time (HH:MM).";
    const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [];
    if (!days.length) return "Pick at least one day of the week.";
    return { kind: "weekly", time: o.time, days };
  }
  if (o.kind === "hourly") {
    const every = Number(o.every);
    if (!Number.isInteger(every) || every < 1 || every > 24) return "Repeat every 1 to 24 hours.";
    if (!isTime(o.from)) return "Pick a start time (HH:MM).";
    return { kind: "hourly", every, from: o.from };
  }
  return "Choose how often the routine runs: every day, some days of the week, or every few hours.";
}

const hm = (t: string): [number, number] => {
  const m = TIME_RE.exec(t);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

/** The hours an "every N hours from HH" schedule runs at, within one day. */
export function hourlySlots(every: number, fromHour: number): number[] {
  const out = new Set<number>();
  for (let h = fromHour; h < fromHour + 24; h += every) out.add(h % 24);
  return [...out].sort((a, b) => a - b);
}

/** Cron patterns (seconds first) whose union is the schedule. Each is fixed-time (see the top of the file). */
export function cronPatterns(s: RoutineSchedule): string[] {
  if (s.kind === "daily") {
    const [h, m] = hm(s.time);
    return [`0 ${m} ${h} * * *`];
  }
  if (s.kind === "weekly") {
    const [h, m] = hm(s.time);
    return [`0 ${m} ${h} * * ${s.days.join(",")}`];
  }
  const [h, m] = hm(s.from);
  return hourlySlots(s.every, h).map((hour) => `0 ${m} ${hour} * * *`);
}

const crons = (s: RoutineSchedule, tz: string) => cronPatterns(s).map((p) => new Cron(p, { timezone: tz }));

/** The first scheduled time strictly after `afterMs`, or null. */
export function nextRun(s: RoutineSchedule, tz: string, afterMs: number): number | null {
  let best: number | null = null;
  for (const c of crons(s, tz)) {
    const d = c.nextRun(new Date(afterMs));
    if (d && (best === null || d.getTime() < best)) best = d.getTime();
  }
  return best;
}

/** The latest scheduled time in [fromMs, nowMs], or null if there's none. */
export function latestDue(s: RoutineSchedule, tz: string, fromMs: number, nowMs: number): number | null {
  let best: number | null = null;
  // previousRuns looks strictly before its reference, and run times are whole seconds.
  const ref = new Date(Math.floor(nowMs / 1000) * 1000 + 1000);
  for (const c of crons(s, tz)) {
    const d = c.previousRuns(1, ref)[0];
    const t = d?.getTime();
    if (t !== undefined && t >= fromMs && t <= nowMs && (best === null || t > best)) best = t;
  }
  return best;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Plain English, for approval cards, the main bot and Telegram ("every day at 08:00"). The UI has its own, translated. */
export function describeSchedule(s: RoutineSchedule): string {
  if (s.kind === "daily") return `every day at ${s.time}`;
  if (s.kind === "weekly") {
    if (s.days.length === 7) return `every day at ${s.time}`;
    const key = s.days.join(",");
    if (key === "1,2,3,4,5") return `on weekdays at ${s.time}`;
    if (key === "0,6") return `on weekends at ${s.time}`;
    return `${s.days.map((d) => DAY_NAMES[d]).join(", ")} at ${s.time}`;
  }
  return s.every === 1 ? `every hour from ${s.from}` : s.every === 24 ? `every day at ${s.from}` : `every ${s.every} hours from ${s.from}`;
}

// ---------- the scheduler's decisions ----------

/** busy: the routine's chat is running something. waiting: it's waiting for the user's OK (or a plan review). */
export type ChatState = "free" | "busy" | "waiting";

export type TickInput = {
  nextRunAt: number | null;
  lastStartedAt?: number;
  /** When this due time was first found busy (kept in memory by the scheduler). */
  busySince?: number;
};

export type TickDecision =
  | { kind: "idle" }
  | { kind: "wait"; occurrence: number; busySince: number }
  | { kind: "run"; occurrence: number; next: number | null }
  | { kind: "skip"; occurrence: number; status: Extract<RoutineRunStatus, "missed" | "skipped">; note: "missed" | "busy" | "waiting" | "recent"; next: number | null };

/** What to do with one enabled routine at `now`. */
export function decideTick(s: RoutineSchedule, tz: string, st: TickInput, now: number, chat: ChatState): TickDecision {
  if (st.nextRunAt === null || now < st.nextRunAt) return { kind: "idle" };
  // Asleep or closed for a while: only the latest missed time counts.
  const occurrence = latestDue(s, tz, st.nextRunAt, now) ?? st.nextRunAt;
  const next = nextRun(s, tz, now);
  if (now - occurrence > CATCH_UP_MS) return { kind: "skip", occurrence, status: "missed", note: "missed", next };
  if (st.lastStartedAt !== undefined && now - st.lastStartedAt < MIN_GAP_MS && st.lastStartedAt <= now) return { kind: "skip", occurrence, status: "skipped", note: "recent", next };
  if (chat !== "free") {
    const since = st.busySince ?? now;
    if (now - since >= BUSY_RETRY_MS) return { kind: "skip", occurrence, status: "skipped", note: chat, next };
    return { kind: "wait", occurrence, busySince: since };
  }
  return { kind: "run", occurrence, next };
}

/** Failure count after a run, and whether the routine must be paused. */
export function afterRun(failures: number, status: RoutineRunStatus): { failures: number; pause: boolean } {
  if (status === "ok") return { failures: 0, pause: false };
  if (status !== "error") return { failures, pause: false };
  const n = failures + 1;
  return { failures: n, pause: n >= MAX_FAILURES };
}

// ---------- reading a run's result back from its chat ----------

/** theOovi errorCode values meaning "out of credits for now" (the notification says so). Runs are never retried. */
export const CREDIT_CODES: ReadonlySet<string> = new Set(["no_credits", "daily_limit"]);

export type RunResult = {
  status: Extract<RoutineRunStatus, "ok" | "error" | "skipped" | "waiting">;
  /** Final reply (ok), the error (error), what needs approval (waiting), or why it stopped (skipped). */
  text: string;
  errorCode?: string;
  /** Still running (the caller should look again later). */
  pending?: boolean;
};

/** The outcome of the run that started with user entry `entryId`: replies up to the next user message. */
export function resultOf(chat: Chat, entryId: string, running = false): RunResult {
  const i = chat.entries.findIndex((e) => e.id === entryId);
  if (i < 0) return { status: "error", text: "The run's message is no longer in its chat." };
  const after: BotEntry[] = [];
  for (const e of chat.entries.slice(i + 1)) {
    if (e.kind === "user") break;
    after.push(e);
  }
  const approval = chat.pending?.approval;
  if (approval && after.some((e) => e.id === approval.entryId)) {
    return { status: "waiting", text: approval.items.map((x) => x.summary).join("; ").slice(0, 600) || "A tool needs your OK." };
  }
  const review = chat.pending?.planReview;
  if (review && after.some((e) => e.id === review.entryId)) return { status: "waiting", text: "A plan is waiting for your review." };
  if (running) return { status: "ok", text: "", pending: true };
  const last = [...after].reverse().find((e) => e.text || e.error || e.status === "error" || e.status === "stopped") ?? after.at(-1);
  if (!last) return { status: "error", text: "No reply." };
  if (last.status === "error") return { status: "error", text: last.error || "The bot couldn't reply.", ...(last.errorCode ? { errorCode: last.errorCode } : {}) };
  if (last.status === "stopped") return { status: "skipped", text: "stopped" };
  if (last.status === "running" || last.status === "waiting") return { status: "error", text: "The run ended before the bot finished." };
  return last.text ? { status: "ok", text: last.text } : { status: "error", text: "The bot finished without a reply." };
}
