// Self-learning: the bots get better the more they're used.
//
// 1. Reflection: after real work (several tool steps, Deep work, or the user
//    correcting a bot) one cheap call reviews what happened and saves short,
//    reusable lessons, plus durable facts about the user's preferences.
// 2. Feedback: thumbs up/down on a reply. Thumbs down (with an optional note)
//    is turned into a lesson; thumbs up makes that reply's lessons rank higher.
// 3. Recall: lessons live in a growing store (not in every prompt). Each request
//    gets only the few lessons that match it, so the store can grow to hundreds
//    of entries without making every call more expensive.
// 4. Skills: when a multi-step procedure worked and is likely to come back, the
//    reflection drafts a skill the user can save with one click.

import fs from "node:fs";
import path from "node:path";
import { complete } from "./llm";
import { SUSPICIOUS, applyMemory } from "./memory";
import { dataDir, type Settings } from "./settings";
import { tokens } from "./skills";
import type { Bot, BotEntry, LearnedNote, Msg } from "./types";
import { WRONG_LESSON } from "./lesson-rules";
export { WRONG_LESSON };

export type Lesson = {
  id: string;
  text: string;
  /** Bot that learned it (lessons are shared by all bots, this is for display). */
  botId?: string;
  source: "reflection" | "feedback";
  /** Reply it came from, so thumbs up/down can rate it. */
  entryId?: string;
  /** Goes up with thumbs up and when the same lesson is learned again. */
  score: number;
  createdAt: number;
  updatedAt: number;
};

const MAX_LESSONS = 400;
const file = () => path.join(dataDir(), "memory", "lessons.json");


export function listLessons(): Lesson[] {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8")) as { lessons?: Lesson[] };
    const all = Array.isArray(j.lessons) ? j.lessons : [];
    const kept = all.filter((l) => !WRONG_LESSON.test(l.text));
    if (kept.length !== all.length) writeLessons(kept);
    return kept;
  } catch {
    return [];
  }
}

/** Restore from a backup: lessons with the same id are replaced, others kept. */
export function importLessons(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  const cur = listLessons();
  let n = 0;
  for (const x of raw.slice(0, 2000)) {
    const l = x as Partial<Lesson>;
    if (!l || typeof l.id !== "string" || typeof l.text !== "string" || !l.text.trim()) continue;
    const i = cur.findIndex((c) => c.id === l.id);
    const clean = { ...(l as Lesson), text: l.text.slice(0, 600) };
    if (i >= 0) cur[i] = clean;
    else cur.push(clean);
    n++;
  }
  writeLessons(cur.slice(-400));
  return n;
}

function writeLessons(lessons: Lesson[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ lessons }, null, 1));
}

const similarity = (a: Set<string>, b: Set<string>) => {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.max(1, a.size + b.size - inter);
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 300);

/** Save a lesson. Learning the same thing again updates it and raises its score. */
export function addLesson(text: string, meta: { botId?: string; source: Lesson["source"]; entryId?: string }): Lesson | null {
  const t = clean(text);
  if (t.length < 12 || SUSPICIOUS.test(t) || WRONG_LESSON.test(t)) return null;
  const lessons = listLessons();
  const tk = tokens(t);
  const same = lessons.find((l) => similarity(tokens(l.text), tk) >= 0.6);
  const now = Date.now();
  if (same) {
    same.text = t;
    same.score += 1;
    same.updatedAt = now;
    if (meta.entryId) same.entryId = meta.entryId;
    writeLessons(lessons);
    return same;
  }
  const l: Lesson = { id: crypto.randomUUID().replace(/-/g, "").slice(0, 12), text: t, botId: meta.botId, source: meta.source, entryId: meta.entryId, score: meta.source === "feedback" ? 2 : 1, createdAt: now, updatedAt: now };
  let next = [...lessons, l];
  if (next.length > MAX_LESSONS) {
    // Forget the weakest, oldest lessons first.
    next = next.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, MAX_LESSONS);
  }
  writeLessons(next);
  return l;
}

export function deleteLesson(id: string): void {
  writeLessons(listLessons().filter((l) => l.id !== id));
}

export function editLesson(id: string, text: string): Lesson | null {
  const lessons = listLessons();
  const l = lessons.find((x) => x.id === id);
  const t = clean(text);
  if (!l || t.length < 3 || SUSPICIOUS.test(t)) return null;
  l.text = t;
  l.updatedAt = Date.now();
  writeLessons(lessons);
  return l;
}

/** Rate the lessons that came from one reply. */
export function rateLessons(entryId: string, delta: number): void {
  const lessons = listLessons();
  let hit = false;
  for (const l of lessons) if (l.entryId === entryId) ((l.score = Math.max(0, l.score + delta)), (hit = true));
  if (hit) writeLessons(lessons);
}

/** Raise or lower one lesson's score (0 = never recalled). Settings > Memory & soul uses this. */
export function scoreLesson(id: string, delta: number): Lesson | null {
  const lessons = listLessons();
  const l = lessons.find((x) => x.id === id);
  if (!l) return null;
  l.score = Math.max(0, Math.min(20, l.score + Math.sign(delta)));
  writeLessons(lessons);
  return l;
}

/** The lessons that match a request, best first. */
export function relevantLessons(text: string, max = 6): Lesson[] {
  const t = tokens(text);
  if (!t.size) return [];
  return listLessons()
    .filter((l) => l.score > 0)
    .map((l) => {
      const lt = tokens(l.text);
      let hit = 0;
      for (const w of lt) if (t.has(w)) hit++;
      // Word overlap first; a well-rated lesson wins ties.
      return { l, rank: hit / Math.max(3, Math.min(lt.size, 10)) + Math.min(l.score, 5) * 0.02 };
    })
    .filter((x) => x.rank >= 0.2)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, max)
    .map((x) => x.l);
}

/** Prompt block with the lessons for this request (empty when none match). */
export function lessonsPrompt(request: string): string {
  const ls = relevantLessons(request);
  if (!ls.length) return "";
  return ["Lessons from earlier work that match this request (apply them):", ...ls.map((l) => `- ${l.text}`)].join("\n");
}

// ---------- reflection ----------

/** The user telling a bot it got something wrong, or how they want things done. */
// English, French and Arabic (incl. Algerian Darija): users correct bots in the language they write in.
export const CORRECTION = new RegExp(
  [
    String.raw`^(no\b|nope|not (that|what|quite)|wrong|that'?s (not|wrong)|actually|i (said|meant|asked)|instead|don'?t|do not|stop|why did you|you (forgot|missed|didn'?t))`,
    String.raw`\b(next time|from now on|always|never|i prefer|i'd rather|too (long|short|formal|casual))\b`,
    String.raw`^(non\b|pas (ça|ca|comme ça)|c'?est faux|en fait|j'?ai dit|plutôt|plutot|arr[êe]te|pourquoi tu)`,
    String.raw`\b(la prochaine fois|désormais|dorénavant|toujours|jamais|je préfère|trop (long|court|formel))`,
    // (\b doesn't work after Arabic letters: JavaScript's word boundary only knows ASCII.)
    "^(لا(?=[\\s،.!؟]|$)|لالا|ماشي هكا|غالط|خطأ|قلتلك|ماشي هذا|علاش)",
    "(المرة الجاية|المرة القادمة|من دروك|دايما|دائما|ابدا|أبدا|نفضل|أفضل|طويل بزاف|قصير بزاف)",
  ].join("|"),
  "i",
);

const REFLECT_SYSTEM = `You help an AI assistant team learn from finished work so it does better next time.
You get the user's request, what the bots did (tools used, errors, final answer) and sometimes the user's feedback or correction.
Return ONLY a JSON object, no other text:
{"lessons": string[], "user": string[], "skill": null | {"name": string, "description": string, "steps": string[]}}

lessons: 0-3 short, specific, reusable lessons (max 200 characters each) that would make similar future tasks faster or better. Good: "For flight prices, Google Flights pages need the browser; read_url returns no prices." "The user's company files are in the Reports folder; check there first." Bad: generic advice ("be thorough", "double-check work"), facts that only matter for this one task, anything secret.
If the user corrected the bots or gave feedback, the most important lesson is what to do differently. When the user contradicts the bots (for example "it works, it just takes time to load"), the user is right: never save the bots' mistaken conclusion.
Never turn a guess about why something failed into a lesson ("the site is down", "the tunnel is offline", "the link expired") unless an error message proved it: a blank, slow or still-loading page proves nothing. Never save a lesson that tells bots to give up, stop retrying or skip checking.
user: 0-2 durable facts about the user's preferences shown here (format, tone, tools, recurring projects, the business or people they work with). Only if clearly shown. Never record which language the user wrote in (they switch languages); only an explicit request like "always answer me in French".
skill: only when this was a multi-step procedure that worked well and is likely to be asked again; name (2-5 words), one-line description of when to use it, and 3-8 concrete steps. Otherwise null.
Empty arrays are normal. Never invent lessons.`;

function describeWork(work: { bot: Bot; entry: BotEntry }[]): string {
  const out: string[] = [];
  for (const { bot, entry } of work) {
    out.push(`## ${bot.name}${bot.role ? ` (${bot.role})` : ""}`);
    for (const s of entry.steps as Msg[]) {
      if (s.role === "assistant") {
        for (const c of s.toolCalls) out.push(`- tool ${c.name} ${JSON.stringify(c.input).slice(0, 160)}`);
      } else if (s.role === "tool") {
        for (const r of s.results) if (r.isError) out.push(`  ! ${r.name} failed: ${r.content.slice(0, 200)}`);
      }
    }
    if (entry.error) out.push(`! stopped with error: ${entry.error.slice(0, 200)}`);
    out.push(`Final answer: ${entry.text.slice(0, 1500) || "(none)"}`);
  }
  return out.join("\n").slice(0, 12_000);
}

function parseJson(text: string): { lessons?: unknown; user?: unknown; skill?: unknown } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as { lessons?: unknown; user?: unknown; skill?: unknown };
  } catch {
    return null;
  }
}

const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => clean(x)).slice(0, max) : []);

/**
 * Review finished work and save what was learned. Returns the note shown under
 * the reply (null when nothing worth keeping came out of it).
 */
export async function reflect(
  s: Settings,
  input: { request: string; previous?: string; work: { bot: Bot; entry: BotEntry }[]; feedback?: { rating: "up" | "down"; note?: string } },
  signal?: AbortSignal,
): Promise<LearnedNote | null> {
  const last = input.work.at(-1);
  if (!last) return null;
  const parts = [`User's request:\n${input.request.slice(0, 3000)}`];
  if (input.previous) parts.push(`The bots' previous answer, which this request may be correcting:\n${input.previous.slice(0, 1500)}`);
  parts.push(`What the bots did:\n${describeWork(input.work)}`);
  if (input.feedback) parts.push(`User feedback on the final answer: ${input.feedback.rating === "up" ? "👍 good" : "👎 not good"}${input.feedback.note ? `: "${input.feedback.note.slice(0, 600)}"` : ""}`);
  const timeout = AbortSignal.timeout(45_000);
  const out = await complete(s, REFLECT_SYSTEM, [{ role: "user", content: parts.join("\n\n") }], [], signal ? AbortSignal.any([signal, timeout]) : timeout, { effort: "low" });
  const j = parseJson(out.text);
  if (!j) return null;

  const source: Lesson["source"] = input.feedback ? "feedback" : "reflection";
  const lessons = strings(j.lessons, 3)
    .map((t) => addLesson(t, { botId: last.bot.id, source, entryId: last.entry.id }))
    .filter((l): l is Lesson => !!l)
    .map((l) => l.text);
  const user: string[] = [];
  // Facts "about the user" only when the user wrote the request (not another person in a shared Telegram group).
  const fromSomeoneElse = /^\[[^\]]{1,60} on Telegram\]/.test(input.request.trim());
  if (!fromSomeoneElse) for (const fact of strings(j.user, 2)) if (/^(Saved|Already)/.test(applyMemory("add", "user", fact))) user.push(fact);

  let skill: LearnedNote["skill"];
  const sk = j.skill as { name?: unknown; description?: unknown; steps?: unknown } | null;
  if (sk && typeof sk.name === "string" && typeof sk.description === "string") {
    const steps = strings(sk.steps, 10);
    if (steps.length >= 2 && !SUSPICIOUS.test(steps.join(" "))) {
      skill = { name: clean(sk.name).slice(0, 60), description: clean(sk.description).slice(0, 200), body: steps.map((x, i) => `${i + 1}. ${x}`).join("\n") };
    }
  }
  if (!lessons.length && !user.length && !skill) return null;
  return { lessons, user, ...(skill ? { skill } : {}), at: Date.now() };
}

/** Merge a new note into what a reply already learned. */
export function mergeLearned(a: LearnedNote | undefined, b: LearnedNote): LearnedNote {
  if (!a) return b;
  const uniq = (xs: string[]) => [...new Set(xs)].slice(-6);
  return { lessons: uniq([...a.lessons, ...b.lessons]), user: uniq([...a.user, ...b.user]), skill: b.skill ?? a.skill, skillSaved: a.skillSaved, at: b.at };
}
