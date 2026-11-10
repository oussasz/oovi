// Routines: scheduled tasks ("every morning, summarize my email").
//   data/routines.json   all routines (at most 50)
// Each routine runs in its own chat (kind "direct", one bot, chat.routine = the routine's id),
// so its history stays small and runs are comparable. Those chats aren't listed in the
// sidebar; the Routines page links to them. The scheduler lives in routines-scheduler.ts.

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
    typeof validateSchedule(o.schedule) !== "string" &&
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

export const viewOf = (r: Routine): RoutineView => ({ ...r, running: isRunning(r.chatId) });

// ---------- validation ----------

export type RoutineInput = { name: string; botId: string; prompt: string; schedule: RoutineSchedule; timezone: string; enabled: boolean; notifyTelegram: boolean };

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
  return { name, botId, prompt, schedule, timezone, enabled, notifyTelegram };
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
    Object.assign(x, input);
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

/** Deletes the routine and its chat. A run still going is stopped first. */
export function deleteRoutine(id: string): boolean {
  const all = listRoutines();
  const r = all.find((x) => x.id === id);
  if (!r) return false;
  save(all.filter((x) => x.id !== id));
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
