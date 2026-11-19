/**
 * When the user wrote. Bots saw no clock at all (only today's date in their instructions), so a reminder
 * "in 10 minutes" asked at 10:46 still looked fresh at 22:39 and the bot kept asking "did you turn the oven
 * off?" in every reply. Each user message now carries its local time, and the gap since the message before
 * it when it is long, so the model can tell what is over.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "40 minutes", "11 hours", "3 days": the gap in plain words (rounded down). */
export function gapWords(ms: number): string {
  if (ms >= 2 * DAY) return `${Math.floor(ms / DAY)} days`;
  if (ms >= 2 * HOUR) return `${Math.floor(ms / HOUR)} hours`;
  if (ms >= HOUR) return "1 hour";
  return `${Math.max(1, Math.floor(ms / MIN))} minutes`;
}

/** Below this, the gap isn't worth saying (a normal back-and-forth). */
export const GAP_WORTH_SAYING = 30 * MIN;

/**
 * The note on a user message: its local time (weekday, date, hour), and how long after the previous message
 * of the chat it came when that is 30 minutes or more. Written once per message, so the prompt stays cached.
 */
export function timeNote(at: number, previousAt: number | undefined, timeZone?: string): string {
  let when: string;
  try {
    when = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
  } catch {
    when = new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
  const gap = previousAt !== undefined && at - previousAt >= GAP_WORTH_SAYING ? `, ${gapWords(at - previousAt)} after the previous message` : "";
  return `[oovi: sent ${when}${gap}]`;
}
