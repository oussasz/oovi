// Routines: scheduled tasks ("every morning, summarize my email").
//   data/routines.json   all routines (at most 50)
// Each routine runs in its own chat (kind "direct", one bot, chat.routine = the routine's id),
// so its history stays small and runs are comparable. Those chats aren't listed in the
// sidebar; the Routines page links to them. The scheduler lives in routines-scheduler.ts.

import { cloudUrl } from "./account";
import fs from "node:fs";
import path from "node:path";
import { isRunning, stopRun, subscribe } from "./runner";
import { MAX_ROUTINES, NAME_MAX, PROMPT_MAX, isTimeZone, localTimeZone, nextRun, validateSchedule } from "./routines-schedule";
import { dataDir } from "./settings";
import { deleteChat, getBot, getChat, ID_RE, listBots, newId, saveChat } from "./store";
import type { Chat, Routine, RoutineSchedule, RoutineView } from "./types";

const file = () => path.join(dataDir(), "routines.json");

function readJson<T>(f: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(f: string, data: unknown) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, f);
}

const RUN_STATUSES: ReadonlySet<string> = new Set(["ok", "error", "skipped", "missed", "waiting"]);

/** Drop anything that isn't a well-formed routine (a hand-edited or damaged file must not crash the scheduler). */
function sane(r: unknown): r is Routine {
  const o = r as Partial<Routine> | null;
  return (
    !!o &&
    typeof o.id === "string" &&
    ID_RE.test(o.id) &&
    typeof o.name === "string" &&
    typeof o.botId === "string" &&
    typeof o.prompt === "string" &&
    typeof o.chatId === "string" &&
    ID_RE.test(o.chatId) &&
    typeof validateSchedule(o.schedule, true) !== "string" &&
    isTimeZone(o.timezone)
  );
}

export function listRoutines(): Routine[] {
  const j = readJson<{ routines?: unknown[] }>(file());
  return (Array.isArray(j?.routines) ? j.routines : []).filter(sane).map((r) => ({
    ...r,
    enabled: r.enabled === true,
    notifyTelegram: r.notifyTelegram === true,
    failures: Number.isInteger(r.failures) && r.failures > 0 ? r.failures : 0,
    nextRunAt: typeof r.nextRunAt === "number" && Number.isFinite(r.nextRunAt) ? r.nextRunAt : null,
    lastRun: r.lastRun && typeof r.lastRun.at === "number" && RUN_STATUSES.has(r.lastRun.status) ? r.lastRun : undefined,
  }));
}

const save = (routines: Routine[]) => writeJson(file(), { routines });

export function getRoutine(id: string): Routine | undefined {
  return listRoutines().find((r) => r.id === id);
}

/**
 * Read, change and write one routine in a single synchronous step (nothing else can
 * interleave). fn returns false to cancel. Returns the saved routine, or null.
 */
export function mutateRoutine(id: string, fn: (r: Routine) => void | false): Routine | null {
  const all = listRoutines();
  const r = all.find((x) => x.id === id);
  if (!r || fn(r) === false) return null;
  r.updatedAt = Date.now();
  save(all);
  return r;
}

export const viewOf = (r: Routine): RoutineView => {
  const { hook, ...rest } = r;
  return { ...rest, running: isRunning(r.chatId), ...(hook ? { hookUrl: `${cloudUrl()}/api/v1/hooks/${hook.id}/${hook.secret}` } : {}) };
};

// ---------- validation ----------

export type RoutineInput = { name: string; botId: string; prompt: string; schedule: RoutineSchedule; timezone: string; enabled: boolean; notifyTelegram: boolean; quiet: boolean; watch?: { url: string }; postTo?: string; remind?: boolean; postTelegram?: boolean; lang?: string };

// Control characters out (newlines and tabs stay in the instruction).
const cleanName = (v: unknown) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const cleanPrompt = (v: unknown) =>
  String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim();

/**
 * Checks everything that comes from the page or a bot. With `current`, missing fields keep
 * their current value (a partial update). Returns a clean input, or an error message.
 */
export function validateRoutine(input: unknown, current?: Routine): RoutineInput | string {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const has = (k: string) => o[k] !== undefined;
  if (!current) for (const k of ["name", "botId", "prompt", "schedule"]) if (!has(k)) return "Fill in the name, bot, instruction and schedule.";

  const name = has("name") ? cleanName(o.name) : (current?.name ?? "");
  if (!name) return "Give the routine a name.";
  if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;

  const botId = has("botId") ? String(o.botId) : (current?.botId ?? "");
  // A routine whose bot was deleted can still be paused or renamed; running it again needs a bot.
  if ((has("botId") || !current || o.enabled === true) && !getBot(botId)) return "Pick one of your bots.";

  const prompt = has("prompt") ? cleanPrompt(o.prompt) : (current?.prompt ?? "");
  if (!prompt) return "Write what the bot should do.";
  if (prompt.length > PROMPT_MAX) return `Keep the instruction under ${PROMPT_MAX} characters.`;

  let schedule: RoutineSchedule;
  if (has("schedule")) {
    const s = validateSchedule(o.schedule);
    if (typeof s === "string") return s;
    schedule = s;
  } else if (current) schedule = current.schedule;
  else return "Choose a schedule.";

  // The time zone of the machine the routine was set up on. Unknown names are refused, not guessed.
  let timezone = current?.timezone ?? localTimeZone();
  if (has("timezone")) {
    if (!isTimeZone(o.timezone)) return "Unknown time zone.";
    timezone = o.timezone;
  }

  if (has("enabled") && typeof o.enabled !== "boolean") return "enabled must be true or false.";
  if (has("notifyTelegram") && typeof o.notifyTelegram !== "boolean") return "notifyTelegram must be true or false.";
  const enabled = has("enabled") ? (o.enabled as boolean) : (current?.enabled ?? true);
  const notifyTelegram = has("notifyTelegram") ? (o.notifyTelegram as boolean) : (current?.notifyTelegram ?? false);
  if (has("quiet") && typeof o.quiet !== "boolean") return "quiet must be true or false.";
  const quiet = has("quiet") ? (o.quiet as boolean) : (current?.quiet ?? false);
  // A page checked before each run (plain code, no AI): a public web address only.
  let watch: { url: string } | undefined = current?.watch ? { url: current.watch.url } : undefined;
  if (has("watch")) {
    const raw = o.watch && typeof o.watch === "object" ? (o.watch as { url?: unknown }).url : o.watch;
    const url = typeof raw === "string" ? raw.trim() : "";
    if (!url) watch = undefined;
    else {
      if (url.length > 2000 || !/^https?:\/\/[^\s]+$/i.test(url)) return "The page to watch must be a web address (https://…).";
      watch = { url };
    }
  }
  return { name, botId, prompt, schedule, timezone, enabled, notifyTelegram, quiet, ...(watch ? { watch } : {}) };
}

// ---------- the routine's own chat ----------

const chatName = (r: { name: string }) => `⏰ ${r.name}`.slice(0, 64);

function newChat(r: Routine): Chat {
  const now = Date.now();
  const chat: Chat = { id: newId(), kind: "direct", name: chatName(r), memberIds: [r.botId], leadId: r.botId, createdAt: now, updatedAt: now, entries: [], routine: r.id };
  saveChat(chat);
  return chat;
}

/**
 * The cloud runner: the routine uses the computer's chat for it (same id, so the result shows there once synced),
 * made here when the account has never had it. false: no such routine.
 */
export function useRoutineChat(id: string, chatId: string): boolean {
  const r = mutateRoutine(id, (x) => {
    x.chatId = chatId;
  });
  if (!r) return false;
  const cur = getChat(chatId);
  if (!cur || cur.routine !== r.id) {
    const now = Date.now();
    saveChat({ id: chatId, kind: "direct", name: chatName(r), memberIds: [r.botId], leadId: r.botId, createdAt: now, updatedAt: now, entries: [], routine: r.id });
  }
  return true;
}

/**
 * The routine's chat, created when missing and kept in step with the routine (name, bot).
 * While a run holds the chat in memory nothing is written (the run would overwrite it); the
 * next call catches up.
 */
export function routineChat(r: Routine): Chat {
  const cur = getChat(r.chatId);
  if (!cur || cur.routine !== r.id) {
    const chat = newChat(r);
    mutateRoutine(r.id, (x) => {
      x.chatId = chat.id;
    });
    r.chatId = chat.id;
    return chat;
  }
  if (isRunning(cur.id)) return cur;
  const name = chatName(r);
  if (cur.name !== name || cur.memberIds.length !== 1 || cur.memberIds[0] !== r.botId || cur.leadId !== r.botId || cur.kind !== "direct") {
    cur.name = name;
    cur.kind = "direct";
    cur.memberIds = [r.botId];
    cur.leadId = r.botId;
    saveChat(cur);
  }
  return cur;
}

// ---------- create / update / delete ----------

export function createRoutine(input: RoutineInput): Routine | string {
  const all = listRoutines();
  if (all.length >= MAX_ROUTINES) return `You can have up to ${MAX_ROUTINES} routines. Delete one you don't use first.`;
  const now = Date.now();
  const r: Routine = {
    id: newId(),
    ...input,
    createdAt: now,
    updatedAt: now,
    chatId: "",
    failures: 0,
    nextRunAt: input.enabled ? nextRun(input.schedule, input.timezone, now) : null,
  };
  r.chatId = newChat(r).id;
  save([...all, r]);
  return r;
}

export function updateRoutine(id: string, input: RoutineInput): Routine | null {
  const r = mutateRoutine(id, (x) => {
    const timingChanged = JSON.stringify(x.schedule) !== JSON.stringify(input.schedule) || x.timezone !== input.timezone;
    const turnedOn = input.enabled && !x.enabled;
    // The watched page keeps what was seen last time while its address stays the same.
    const watch = input.watch ? (x.watch?.url === input.watch.url ? x.watch : { url: input.watch.url }) : undefined;
    Object.assign(x, input);
    if (watch) x.watch = watch;
    else delete x.watch;
    if (!x.enabled) {
      x.nextRunAt = null;
    } else if (turnedOn || timingChanged || x.nextRunAt === null) {
      x.nextRunAt = nextRun(x.schedule, x.timezone, Date.now());
    }
    if (turnedOn) {
      // Switched back on after an automatic pause: start counting failures again.
      x.failures = 0;
      delete x.pausedReason;
    }
  });
  if (r) routineChat(r);
  return r;
}

/**
 * Restore routines from a backup: same id replaces, others are kept, at most MAX_ROUTINES.
 * Missed runs aren't caught up (the next run is counted from now), failures start at zero,
 * and each routine gets its chat back (restored with the chats, or a new empty one).
 */
export function importRoutines(raw: unknown[]): number {
  const now = Date.now();
  const incoming = raw
    .filter(sane)
    .map((r): Routine => {
      const enabled = r.enabled === true;
      return {
        id: r.id,
        name: cleanName(r.name).slice(0, NAME_MAX) || "Routine",
        botId: r.botId,
        prompt: cleanPrompt(r.prompt).slice(0, PROMPT_MAX),
        schedule: r.schedule,
        timezone: r.timezone,
        enabled,
        notifyTelegram: r.notifyTelegram === true,
        ...((r as { quiet?: unknown }).quiet === true ? { quiet: true } : {}),
        ...(typeof (r as { watch?: { url?: unknown } }).watch?.url === "string" && /^https?:\/\//i.test((r as { watch: { url: string } }).watch.url) ? { watch: { url: (r as { watch: { url: string } }).watch.url.slice(0, 2000) } } : {}),
        createdAt: typeof r.createdAt === "number" ? r.createdAt : now,
        updatedAt: now,
        chatId: r.chatId,
        failures: 0,
        nextRunAt: enabled ? nextRun(r.schedule, r.timezone, now) : null,
      };
    })
    .filter((r) => r.prompt);
  if (!incoming.length) return 0;
  const byId = new Map(listRoutines().map((r) => [r.id, r]));
  let added = 0;
  for (const r of incoming) {
    if (!byId.has(r.id) && byId.size >= MAX_ROUTINES) continue;
    byId.set(r.id, r);
    added++;
  }
  save([...byId.values()]);
  for (const r of incoming) if (byId.get(r.id) === r) routineChat(r);
  return added;
}

/** Deletes the routine and its chat. A run still going is stopped first. */
export function deleteRoutine(id: string): boolean {
  const all = listRoutines();
  const r = all.find((x) => x.id === id);
  if (!r) return false;
  save(all.filter((x) => x.id !== id));
  // Its web address stops working too (removed on the oovi website).
  if (r.hook) void import("./routine-hooks").then((m) => m.dropHook(r.hook!.id)).catch(() => {});
  const chat = getChat(r.chatId);
  if (!chat || chat.routine !== r.id) return true; // never delete a chat that isn't the routine's own
  if (isRunning(chat.id)) {
    // The run saves the chat once more as it ends: delete it after that.
    const unsub = subscribe(chat.id, (e) => {
      if (e.type !== "done") return;
      unsub?.();
      setTimeout(() => deleteChat(chat.id), 0);
    });
    stopRun(chat.id);
    if (!unsub) deleteChat(chat.id);
  } else {
    deleteChat(chat.id);
  }
  return true;
}

/** Bots by name or id, for routines proposed in chat ("Scout"). */
export function findBot(nameOrId: unknown) {
  const q = String(nameOrId ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!q) return undefined;
  return listBots().find((b) => b.id === q || b.name.toLowerCase() === q);
}
