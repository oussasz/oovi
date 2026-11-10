// The main bot's routine tools. propose_routine never creates anything by itself: it goes
// through the normal approval card ("Create routine 'Morning email' — every day at 08:00"),
// and only runs once the user clicks Allow. list_routines only reads.

import type { ToolSpec } from "./llm";
import { createRoutine, findBot, listRoutines, validateRoutine, type RoutineInput } from "./routines";
import { describeSchedule, localTimeZone } from "./routines-schedule";
import { listBots } from "./store";
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
      frequency: { type: "string", enum: ["daily", "weekly", "hourly"], description: "daily: every day at `time`. weekly: on `days` at `time`. hourly: every `every_hours` hours starting at `time` each day." },
      time: { type: "string", description: "24-hour HH:MM in the user's local time, e.g. 08:00" },
      days: { type: "array", items: { type: "string", enum: [...DAYS] }, description: "weekly only: the days" },
      every_hours: { type: "integer", minimum: 1, maximum: 24, description: "hourly only" },
      bot: { type: "string", description: "Name of the bot that runs it (default: you)" },
      send_to_telegram: { type: "boolean", description: "Also send each result to the user's Telegram (only if they asked)" },
    },
    required: ["name", "instruction", "frequency", "time"],
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
  const schedule =
    freq === "weekly"
      ? { kind: "weekly", time, days: (Array.isArray(i.days) ? i.days : []).map((d) => DAYS.indexOf(String(d).toLowerCase().slice(0, 3) as (typeof DAYS)[number])).filter((d) => d >= 0) }
      : freq === "hourly"
        ? { kind: "hourly", every: Number(i.every_hours), from: time }
        : freq === "daily"
          ? { kind: "daily", time }
          : null;
  if (!schedule) return "frequency must be daily, weekly or hourly.";
  return validateRoutine({
    name: i.name,
    botId: bot.id,
    prompt: i.instruction,
    schedule,
    timezone: localTimeZone(),
    enabled: true,
    notifyTelegram: i.send_to_telegram === true,
  });
}

/** What the approval card says. */
export function describeProposal(call: ToolCall, self?: Bot): { summary: string; detail?: string } {
  const p = proposalOf(call, self);
  if (typeof p === "string") return { summary: `Create a routine: ${p}` };
  const bot = listBots().find((b) => b.id === p.botId)?.name ?? "a bot";
  return {
    summary: `Create routine "${p.name}" — ${describeSchedule(p.schedule)} (${p.timezone}), run by ${bot}${p.notifyTelegram ? ", results also sent to Telegram" : ""}`,
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
          return `- ${r.name} [${r.enabled ? "on" : r.pausedReason ? `paused (${r.pausedReason})` : "off"}]: ${describeSchedule(r.schedule)} (${r.timezone}), run by ${bot}. Next: ${r.enabled ? when(r.nextRunAt, r.timezone) : "—"}. Last: ${last}. Instruction: ${r.prompt.replace(/\s+/g, " ").slice(0, 200)}`;
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
    return ok(`Created the routine "${r.name}": ${describeSchedule(r.schedule)} (${r.timezone}). Next run: ${when(r.nextRunAt, r.timezone)}. Each run happens in its own chat, and the user gets a notification with the result. They can change, pause or run it on the Routines page: [Open Routines](oovi://routines). Routines only run while oovi is open on this computer.`);
  }

  return bad(`Unknown tool: ${call.name}`);
}
