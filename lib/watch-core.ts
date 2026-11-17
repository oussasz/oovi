// A routine's watched page (a price, a product, a feed, a listing): read with plain code before the run,
// and the AI runs only when the page changed, with what changed. Pure: tests/unit/watch.test.mts.

/** The readable text of a page or feed: no scripts, styles or tags; one line per block; trimmed. */
export function pageText(body: string, contentType = ""): string {
  let t = String(body ?? "");
  if (/json/i.test(contentType)) return t.replace(/\s+/g, " ").trim().slice(0, 200_000);
  t = t
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/item|\/entry|\/title|\/td|\/th|\/article|\/section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
  return t
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1)
    .join("\n")
    .slice(0, 200_000);
}

/** Lines that only show the time, a counter or a session (they change on every visit) don't count as a change. */
const NOISE = /^(\d{1,2}:\d{2}(:\d{2})?|updated .* ago|il y a \d+|منذ \d+|\d+ (seconds?|minutes?) ago|csrf|session|©.*\d{4})$/i;

export function significant(text: string): string {
  return text
    .split("\n")
    .filter((l) => !NOISE.test(l))
    .join("\n");
}

/** FNV-1a 32-bit (enough to tell "the same page" from "not the same"). */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** What changed, line by line: "- removed" and "+ added", at most `max` characters. */
export function changedLines(before: string, after: string, max = 3000): string {
  const a = new Set(before.split("\n"));
  const b = new Set(after.split("\n"));
  const out: string[] = [];
  for (const l of before.split("\n")) if (!b.has(l)) out.push(`- ${l}`);
  for (const l of after.split("\n")) if (!a.has(l)) out.push(`+ ${l}`);
  let s = "";
  for (const l of out) {
    if (s.length + l.length + 1 > max) {
      s += `… (${out.length} changed lines in all)`;
      break;
    }
    s += `${l}\n`;
  }
  return s.trim();
}

/** The note added to the run's instruction when the page changed (or was seen for the first time). */
export function watchNote(url: string, before: string | undefined, after: string): string {
  if (before === undefined) return `[oovi: first check of ${url}. What the page shows now (start):\n${after.slice(0, 2500)}]`;
  return `[oovi: ${url} changed since the last check. What changed (- removed, + added):\n${changedLines(before, after)}]`;
}

/** The answer a quiet routine gives when there's nothing worth telling (any language, any case, alone). */
export const NO_NEWS = "NO_NEWS";
export const isNoNews = (text: string) => /^\s*\**\s*NO_NEWS\s*\**\s*\.?\s*$/i.test(String(text ?? ""));

export const QUIET_NOTE = `[oovi: report only when there is something new or worth telling the user. If there is nothing new, reply with exactly ${NO_NEWS} and nothing else: the user then gets no message.]`;
