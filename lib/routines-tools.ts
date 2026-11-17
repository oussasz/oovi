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
    "Propose a routine: a task a bot does on its own on a schedule, e.g. 'every morning at 8, summarize my unread email'. The user sees the details and approves it before it's created. Use it when the user asks for something recurring. Each run happens in the routine's own chat, without the user watching, so write a complete, self-contained instruction.",
  parameters: {
    type: "object",
    properties: {
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
      watch_url: { type: "string", description: "A page or feed to check with plain code before each run (a price, a listing, a news page): when it hasn't changed, the run is skipped at no cost; when it changed, the run gets what changed." },
      days: { type: "array", items: { type: "string", enum: [...DAYS] }, description: "weekly only: the days" },
      every_hours: { type: "integer", minimum: 1, maximum: 24, description: "hourly only" },
      bot: { type: "string", description: "Name of the bot that runs it (default: you)" },
      send_to_telegram: { type: "boolean", description: "Also send each result to the user's Telegram (only if they asked)" },
    },
    required: ["name", "instruction", "frequency"],
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

export function runRoutineTool(call: ToolCall, self: Bot): ToolResult {
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

  if (call.name === "propose_routine") {
    // Reached only after the user clicked Allow on the approval card.
    const p = proposalOf(call, self);
    if (typeof p === "string") return bad(p);
    const r = createRoutine(p);
    if (typeof r === "string") return bad(r);
    const phone = r.notifyTelegram
      ? telegramConnected()
        ? " Results are also sent to the user's Telegram."
        : " Telegram isn't connected yet, so results stay in oovi until the user connects it: tell them so in one line with the link [Connect Telegram](oovi://settings/telegram)."
      : "";
    return ok(`Created the routine "${r.name}": ${describeSchedule(r.schedule, r.timezone)} (${r.timezone}). Next run: ${when(r.nextRunAt, r.timezone)}. Each run happens in its own chat, and the user gets a notification with the result.${phone} They can change, pause or run it on the Routines page: [Open Routines](oovi://routines). Routines only run while oovi is open on this computer.`);
  }

  return bad(`Unknown tool: ${call.name}`);
}
