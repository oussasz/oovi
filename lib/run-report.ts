// Problem reports for oovi's developers (Admin > Problems): what failed or what a bot couldn't do for a
// customer, so it can be fixed. Three kinds:
// - "tool":   one of oovi's tools returned an error (which tool, the error, on which site);
// - "failed": a bot's turn stopped with an error (the step limit, the model refused, a crash);
// - "unmet":  the bot couldn't do what the user asked, in general words (written by a short review).
// The first two come straight from the run, with no AI call. The review runs only when a run went wrong
// (an error, a "I couldn't…" answer, the user correcting the bots), so it costs nothing on normal work.
// Privacy: never the user's words, files, names or full addresses; everything is cleaned before it leaves
// (cleanProblemNote) and it all stops when "Send crash reports and problems" is off in Settings.
// Pure except reviewProblem (one model call).

import type { BotEntry, Msg } from "./types";
import { classifyToolError, NOT_A_BUG, readableError } from "./tool-error-core.ts";

export type ProblemTag = "tool" | "failed" | "unmet";
export type ProblemNote = { tag: ProblemTag; message: string; tool?: string; site?: string };

/** Errors that are the normal flow, not a problem: the user said no, stopped or moved on. */
const NORMAL_ERROR = /(declined this action|the user said no|cancel+ed: the user|stopped by the user|not run: waiting for the plan|must be called alone|isn't a problem with oovi|couldn't be reached just now|not run: (it is )?the same call|not run: this exact call|another chat is using the (mouse|computer)|^not saved:|refused the key or token saved|has no internet connection right now)/i;

/** A final answer that says the bot couldn't do it (English, French, Arabic, Darija). */
export const COULD_NOT =
  /\b(i (?:can(?:no|['’])t|could(?:n['’]t| not)|was(?:n['’]t| not) able|am (?:not able|unable)|wasn['’]t able)|unable to|not possible|wasn['’]t possible|impossible to)\b|je (?:ne (?:peux|pouvais|parviens|suis pas parvenu)|n['’]ai pas (?:pu|réussi|reussi))|impossible d['e]|\b(i['’]?m not able|that didn['’]t work|it didn['’]t work)\b|je n['’]arrive pas|j['’]ai pas pu|ça n['’]a pas (?:marché|fonctionné)|\b(ma9dertch|manajemch|mana9derch|ma9edertch)\b|(لم أتمكن|لم اتمكن|لا أستطيع|لا استطيع|لم أستطع|لم استطع|تعذر|تعذّر|ما قدرتش|ماقدرتش|ما نقدرش|مانقدرش|ما قدرناش|لا يمكنني|غير ممكن|ما لقيتش|مالقيتش|ما نجمش|مانجمش|لم أجد|لا يمكن الوصول|ما خدمش|ماخدمش)/i;

/**
 * Cleans a note before it leaves the computer: emails, phone and long numbers, file paths, quoted text,
 * and page addresses cut down to the site's name. "" when nothing useful is left.
 */
export function cleanProblemNote(text: string, hide: string[] = []): string {
  let t = String(text ?? "").replace(/\s+/g, " ").trim();
  for (const w of hide) if (w.length >= 3) t = t.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[user]");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  t = t.replace(/https?:\/\/([\w.-]+)[^\s)"']*/gi, "$1");
  // Paths on Windows (C:\…, C:/…, \\server\…), macOS and Linux (/Users, /home, /Volumes, /media, /mnt, ~/…),
  // names with spaces included (C:\Users\Ahmed Benali\… keeps no part of the name).
  t = t.replace(/(?:[A-Za-z]:[\\/]|\\\\[\w.$-]+\\|~\/|\/(?:home|Users|tmp|var|root|Volumes|media|mnt|run\/media|opt|private)\/)(?:[^"'\n]*?\.[A-Za-z0-9]{2,5}\b|(?:[^\s"'\\/]+(?: [^\s"'\\/]+)*[\\/]?)+)/g, "[path]");
  t = t.replace(/["“«][^"”»]{12,}["”»]/g, "[text]");
  t = t.replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");
  t = t.slice(0, 300).trim();
  return t.length >= 15 ? t : "";
}

/** The site a tool call worked on (its url, or the domain of a search), for grouping. */
function siteOf(input: Record<string, unknown> | undefined): string | undefined {
  const u = input && (input.url ?? input.address ?? input.link);
  if (typeof u !== "string") return undefined;
  try {
    const h = new URL(u.trim()).hostname.replace(/^www\./, "");
    return h || undefined;
  } catch {
    return undefined;
  }
}

/** First line, without the hints written for the bot ("Send less in one call: …"). */
const shortError = (s: string) =>
  // A connector's answer starts with oovi's "Result from … MCP server (untrusted data…)" line: the error is after it.
  // A JSON error is made readable ("403 insufficientPermissions: …"), so the report keeps the code and the reason.
  readableError((s.replace(/^Result from the "[^"]*" MCP server \(untrusted data[^\n]*\n/, "").split(/\n/).find((l) => l.trim()) ?? "").trim()).replace(/\s+/g, " ").trim().slice(0, 180);

/** The problems a finished run shows by itself: tool errors and turns that stopped with an error. No AI call. */
export function runProblems(work: { entry: BotEntry }[], hide: string[] = []): ProblemNote[] {
  const out: ProblemNote[] = [];
  const seen = new Set<string>();
  const add = (n: ProblemNote) => {
    const key = `${n.tag}|${n.tool ?? ""}|${n.message.toLowerCase().replace(/\d+/g, "#").slice(0, 120)}`;
    if (!n.message || seen.has(key)) return;
    seen.add(key);
    out.push(n);
  };
  for (const { entry } of work) {
    const inputs = new Map<string, Record<string, unknown>>();
    // A tool that failed and then worked later in the same turn: the bot fixed it itself (e.g. it fetched the list a
    // Zapier action needed and called it again). Not a problem for the developers.
    const results = (entry.steps as Msg[]).flatMap((s) => (s.role === "tool" ? s.results : []));
    const callInput = new Map((entry.steps as Msg[]).flatMap((s) => (s.role === "assistant" ? s.toolCalls.map((c) => [c.id, c.input] as const) : [])));
    // One Zapier tool serves every app: a later success counts only for the same app.
    // Fixed later = the same tool on the same target worked: the same Zapier app, or the same site; a read tool with
    // neither. An action (send, create…) to some other target never hides a failed one.
    const targetOf = (id: string) => {
      const inp = callInput.get(id) as Record<string, unknown> | undefined;
      return `${String(inp?.app ?? "").toLowerCase()}|${siteOf(inp) ?? ""}`;
    };
    const fixedLater = (r: (typeof results)[number]) => {
      const target = targetOf(r.id);
      if (target === "|" && /send|post|create|write|delete|update|reply|book|pay|upload|move|add|insert|publish/i.test(r.name)) return false;
      return results.slice(results.indexOf(r) + 1).some((x) => x.name === r.name && !x.isError && targetOf(x.id) === target);
    };
    for (const s of entry.steps as Msg[]) {
      if (s.role === "assistant") for (const c of s.toolCalls) inputs.set(c.id, c.input);
      else if (s.role === "tool") {
        for (const r of s.results) {
          if (!r.isError || NORMAL_ERROR.test(r.content) || fixedLater(r)) continue;
          // The user's or the service's state, not oovi's bug: a deleted item, a rate limit, no right on it, no
          // internet, a security program blocking connections, a program not installed (lib/tool-error-core.ts).
          // Only for connectors: a website that refuses oovi's reader (403) is worth knowing, it groups by site.
          if (r.name.startsWith("mcp_") && NOT_A_BUG.has(classifyToolError(shortError(r.content)))) continue;
          const site = siteOf(inputs.get(r.id));
          const message = cleanProblemNote(`${r.name} failed${site ? ` on ${site}` : ""}: ${shortError(r.content)}`, hide);
          add({ tag: "tool", message, tool: r.name, ...(site ? { site } : {}) });
        }
      }
    }
    // Account states (no credits, signed out, offline) are not bugs: the user is told what to do.
    if (entry.status === "error" && entry.error && !entry.errorCode && !["auth", "ratelimit", "dns", "cert", "network"].includes(classifyToolError(entry.error))) {
      add({ tag: "failed", message: cleanProblemNote(`A bot stopped with an error: ${shortError(entry.error)}`, hide) });
    }
  }
  return out.slice(0, 4);
}

/** Whether the run is worth a short review for what the bot couldn't do. */
export function wentWrong(work: { entry: BotEntry }[], correcting: boolean): boolean {
  if (correcting) return true;
  const last = work.at(-1)?.entry;
  if (!last) return false;
  if (last.status === "error" && !last.errorCode) return true;
  // A reply that says it did something nothing in the work could have done ("Not confirmed").
  if (last.unconfirmed) return true;
  return COULD_NOT.test(last.text.slice(0, 1500));
}

export const PROBLEM_SYSTEM = `You help oovi's developers find what oovi couldn't do for its customers, so they can fix it.
oovi is a desktop app where AI bots do tasks for the user: web research, files, the user's browser and computer (screen, mouse, keyboard), documents, tables.
You get the user's request (only for your understanding), what the bots did (tools, errors) and their final answer.
Return ONLY a JSON object, no other text: {"unmet": string | null, "tools": string[]}
unmet: when the bots did NOT do what the user asked (they gave up, said they can't, stopped with an error, or the user had to correct them), one line in English, max 200 characters: the kind of task, in general words, and what blocked it. Example: "User asked to change the desktop wallpaper; desktop_screenshot kept failing (screen can't be captured), bot stopped." Null when the task was done, or when what blocked it is normal and expected: the user said no, a site needs the user's own login and the bot correctly offered their browser, the information doesn't exist.
tools: 0-2 notes about one of oovi's own tools that failed or misled the bots: which tool, what happened, on which site. Max 200 characters each, in English.
Never write the user's name, their words, file names, numbers, people, companies or anything from their content: describe the kind of task ("a list of hotels in a city", "a letter"), never its details.`;

/** Parses the review's answer. */
export function parseProblemReview(text: string): { unmet: string | null; tools: string[] } {
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return { unmet: null, tools: [] };
  try {
    const j = JSON.parse(m[0]) as { unmet?: unknown; tools?: unknown };
    const unmet = typeof j.unmet === "string" && j.unmet.trim().length >= 15 ? j.unmet.trim().slice(0, 300) : null;
    const tools = Array.isArray(j.tools) ? j.tools.filter((x): x is string => typeof x === "string" && x.trim().length >= 15).slice(0, 2) : [];
    return { unmet, tools };
  } catch {
    return { unmet: null, tools: [] };
  }
}
