// The main bot's routine tools. propose_routine never creates anything by itself: it goes
// through the normal approval card ("Create routine 'Morning email' — every day at 08:00"),
// and only runs once the user clicks Allow. list_routines only reads.

import type { ToolSpec } from "./llm";
import { createRoutine, findBot, listRoutines, validateRoutine, type RoutineInput } from "./routines";
import { describeSchedule, localDateTime, localTimeZone } from "./routines-schedule";

/** Today (plus `plusDays`) as YYYY-MM-DD in a time zone. */
function todayIn(tz: string, plusDays = 0): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + plusDays * 86_400_000));
  } catch {
    return new Date(Date.now() + plusDays * 86_400_000).toISOString().slice(0, 10);
  }
}
import { listBots } from "./store";
import { telegramConnected } from "./telegram";
import type { Bot, ToolCall, ToolResult } from "./types";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export const LIST_ROUTINES_SPEC: ToolSpec = {
  name: "list_routines",
  description: "List the user's routines (scheduled tasks): name, schedule, which bot runs it, whether it's on, next and last run.",
  parameters: { type: "object", properties: {} },
};

export const PROPOSE_ROUTINE_SPEC: ToolSpec = {
  name: "propose_routine",
  description:
    "Propose a routine: a task a bot does on its own on a schedule, e.g. 'every morning at 8, summarize my unread email'. The user sees the details and approves it before it's created. Use it when the user asks for something recurring. Runs are unattended: write a complete, self-contained instruction.",
  parameters: {
    type: "object",
    properties: {
      reminder: { type: "string", description: "Plain reminder: the text to post later as it is, where the user asked (no card)" },
      name: { type: "string", description: "Short name, e.g. 'Morning email'" },
      instruction: { type: "string", description: "What the bot does on each run, written as a complete request." },
      frequency: {
        type: "string",
        enum: ["once", "minutes", "hourly", "daily", "weekly"],
        description: "once: one time only, at `date` + `time` or `in_minutes` from now (reminders: \"remind me at 5\", \"in 20 minutes\"). minutes: every `every_minutes` minutes (15, 20 or 30), between `time` and `until` if given. hourly: every `every_hours` hours starting at `time`. daily: every day at `time`. weekly: on `days` at `time`.",
      },
      time: { type: "string", description: "24-hour HH:MM in the user's local time, e.g. 08:00 (not needed for once with in_minutes, nor for minutes without a window)" },
      date: { type: "string", description: "once: YYYY-MM-DD in the user's local time (default: today, or tomorrow if the time has passed)" },
      in_minutes: { type: "integer", minimum: 1, maximum: 10080, description: "once: run this many minutes from now instead of date + time" },
      every_minutes: { type: "integer", enum: [15, 20, 30], description: "minutes only" },
      until: { type: "string", description: "minutes only: HH:MM when the window ends (with `time` as its start), e.g. 08:00 to 20:00" },
      only_when_new: { type: "boolean", description: "Post only when there is something new or worth telling (monitoring, alerts): a run with nothing new sends nothing." },
      watch_url: { type: "string", description: "A page or feed checked by plain code before each run (price, listing, news): unchanged, the run is skipped for free; changed, the run gets what changed." },
      days: { type: "array", items: { type: "string", enum: [...DAYS] }, description: "weekly only: the days" },
      every_hours: { type: "integer", minimum: 1, maximum: 24, description: "hourly only" },
      bot: { type: "string", description: "Name of the bot that runs it (default: you)" },
      send_to_telegram: { type: "boolean", description: "Also send each result to the user's Telegram (only if they asked)" },
    },
    required: ["frequency"],
  },
};

export const ROUTINE_SPECS: ToolSpec[] = [LIST_ROUTINES_SPEC, PROPOSE_ROUTINE_SPEC];
export const ROUTINE_TOOLS: ReadonlySet<string> = new Set(ROUTINE_SPECS.map((s) => s.name));

/** propose_routine's arguments as a routine, or an error message for the bot. */
export function proposalOf(call: ToolCall, self?: Bot): RoutineInput | string {
  const i = call.input;
  const bot = i.bot === undefined || i.bot === null || i.bot === "" ? self : findBot(i.bot);
  if (!bot) return `No bot called "${String(i.bot ?? "")}". Bots: ${listBots().map((b) => b.name).join(", ")}.`;
  const time = String(i.time ?? "").trim().replace(/^(\d):/, "0$1:");
  const freq = String(i.frequency ?? "");
  const tz = localTimeZone();
  const onceAt = (): number | null => {
    const mins = Number(i.in_minutes);
    if (Number.isInteger(mins) && mins > 0) return Date.now() + mins * 60_000;
    if (!time) return null;
    const date = typeof i.date === "string" && i.date.trim() ? i.date.trim() : todayIn(tz);
    const at = localDateTime(date, time, tz);
    // "At 17:00" said after 17:00 means tomorrow.
    return at !== null && at < Date.now() && !(typeof i.date === "string" && i.date.trim()) ? localDateTime(todayIn(tz, 1), time, tz) : at;
  };
  const schedule =
    freq === "once"
      ? { kind: "once", at: onceAt() }
      : freq === "minutes"
        ? { kind: "minutes", every: Number(i.every_minutes), ...(time && typeof i.until === "string" && i.until.trim() ? { from: time, to: i.until.trim().replace(/^(\d):/, "0$1:") } : {}) }
        : freq === "weekly"
      ? { kind: "weekly", time, days: (Array.isArray(i.days) ? i.days : []).map((d) => DAYS.indexOf(String(d).toLowerCase().slice(0, 3) as (typeof DAYS)[number])).filter((d) => d >= 0) }
      : freq === "hourly"
        ? { kind: "hourly", every: Number(i.every_hours), from: time }
        : freq === "daily"
          ? { kind: "daily", time }
          : null;
  if (!schedule) return "frequency must be once, minutes, hourly, daily or weekly.";
  if (freq !== "once" && !(freq === "minutes") && !time) return "time is required (HH:MM).";
  return validateRoutine({
    name: i.name,
    botId: bot.id,
    prompt: i.instruction,
    schedule,
    timezone: localTimeZone(),
    enabled: true,
    notifyTelegram: i.send_to_telegram === true,
    quiet: i.only_when_new === true,
    ...(typeof i.watch_url === "string" && i.watch_url.trim() ? { watch: { url: i.watch_url.trim() } } : {}),
  });
}

/** What the approval card says. */
export function describeProposal(call: ToolCall, self?: Bot): { summary: string; detail?: string } {
  const p = proposalOf(call, self);
  if (typeof p === "string") return { summary: `Create a routine: ${p}` };
  const bot = listBots().find((b) => b.id === p.botId)?.name ?? "a bot";
  return {
    summary: `Create routine "${p.name}" — ${describeSchedule(p.schedule, p.timezone)} (${p.timezone}), run by ${bot}${p.quiet ? ", posting only when there is something new" : ""}${p.watch ? `, checking ${p.watch.url} first (no AI when it hasn't changed)` : ""}${p.notifyTelegram ? (telegramConnected() ? ", results also sent to Telegram" : ". Results go to Telegram once you connect it (Settings > Telegram); until then they stay in oovi") : ""}`,
    detail: p.prompt,
  };
}

const when = (ms: number | null | undefined, tz: string) => {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date(ms).toISOString();
  }
};

/** Where the request came from: the chat (results and reminders are posted back there) and whether it came from Telegram. */
export type RoutineOrigin = { chatId?: string; fromTelegram?: boolean };

/** A plain reminder: propose_routine with `reminder` and frequency once (no card, no AI run). */
export const isReminder = (call: ToolCall) => call.name === "propose_routine" && typeof call.input.reminder === "string" && call.input.reminder.trim() !== "" && (call.input.frequency ?? "once") === "once";

/** A reminder's arguments as a one-time routine, or an error message for the bot. */
export function reminderOf(call: ToolCall, self: Bot, origin: RoutineOrigin = {}): RoutineInput | string {
  const i = call.input;
  const text = String(i.reminder ?? i.text ?? "").trim();
  if (!text) return "Write the reminder's text.";
  if (!(Number(i.in_minutes) > 0) && !String(i.time ?? "").trim()) return "Say when: in_minutes, or time (HH:MM) with an optional date.";
  const p = proposalOf({ ...call, input: { name: text.replace(/\s+/g, " ").slice(0, 40), instruction: text, frequency: "once", in_minutes: i.in_minutes, time: i.time, date: i.date } }, self);
  if (typeof p === "string") return p;
  const tg = i.send_to_telegram === true || origin.fromTelegram === true;
  return { ...p, remind: true, notifyTelegram: tg, ...(tg ? { postTelegram: true } : {}), ...(origin.chatId ? { postTo: origin.chatId } : {}) };
}

export function runRoutineTool(call: ToolCall, self: Bot, origin: RoutineOrigin = {}): ToolResult {
  const ok = (content: string): ToolResult => ({ id: call.id, name: call.name, content });
  const bad = (content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });

  if (call.name === "list_routines") {
    const all = listRoutines();
    if (!all.length) return ok("The user has no routines yet. They can add one on the Routines page (oovi://routines), or you can propose one with propose_routine.");
    const bots = listBots();
    return ok(
      all
        .map((r) => {
          const bot = bots.find((b) => b.id === r.botId)?.name ?? "(deleted bot)";
          const last = r.lastRun ? `${r.lastRun.status}${r.lastRun.note ? ` (${r.lastRun.note.slice(0, 120)})` : ""} at ${when(r.lastRun.at, r.timezone)}` : "never ran";
          return `- ${r.name} [${r.enabled ? "on" : r.pausedReason ? `paused (${r.pausedReason})` : "off"}]: ${describeSchedule(r.schedule, r.timezone)} (${r.timezone}), run by ${bot}. Next: ${r.enabled ? when(r.nextRunAt, r.timezone) : "—"}. Last: ${last}. Instruction: ${r.prompt.replace(/\s+/g, " ").slice(0, 200)}`;
        })
        .join("\n"),
    );
  }

  if (isReminder(call)) {
    const p = reminderOf(call, self, origin);
    if (typeof p === "string") return bad(p);
    const r = createRoutine(p);
    if (typeof r === "string") return bad(r);
    const where = p.postTelegram
      ? telegramConnected()
        ? "on Telegram and in this chat in oovi"
        : "in this chat in oovi (Telegram isn't connected: tell the user in one line, with [Connect Telegram](oovi://settings/telegram))"
      : "in this chat, with a desktop notification";
    return ok(`Reminder set for ${when(r.nextRunAt, r.timezone)} (${r.timezone}). It will be posted ${where}. Tell the user the time in one short line. oovi must stay open on the computer for it to arrive (it can be minimized): say so briefly.`);
  }

  if (call.name === "propose_routine") {
    // Reached only after the user clicked Allow on the approval card.
    const p0 = proposalOf(call, self);
    if (typeof p0 === "string") return bad(p0);
    // A one-time task reports back where it was asked; a recurring one too when asked from Telegram.
    const p = { ...p0, ...(origin.chatId && p0.schedule.kind === "once" ? { postTo: origin.chatId } : {}), ...(origin.fromTelegram ? { notifyTelegram: true, postTelegram: true } : {}) };
    const r = createRoutine(p);
    if (typeof r === "string") return bad(r);
    const phone = r.notifyTelegram
      ? telegramConnected()
        ? " Results are also sent to the user's Telegram."
        : " Telegram isn't connected yet, so results stay in oovi until the user connects it: tell them so in one line with the link [Connect Telegram](oovi://settings/telegram)."
      : "";
    const back = r.postTo ? " The result is also posted in this chat." : "";
    return ok(`Created the routine "${r.name}": ${describeSchedule(r.schedule, r.timezone)} (${r.timezone}). Next run: ${when(r.nextRunAt, r.timezone)}. Each run happens in its own chat, and the user gets a notification with the result.${back}${phone} They can change, pause or run it on the Routines page: [Open Routines](oovi://routines). Routines only run while oovi is open on this computer.`);
  }

  return bad(`Unknown tool: ${call.name}`);
}
