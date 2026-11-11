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
import { SUSPICIOUS, applyMemory, readEntries } from "./memory";
import { dataDir, type Settings } from "./settings";
import { tokens } from "./skills";
import type { Bot, BotEntry, LearnedNote, Msg } from "./types";
import { TECHNICAL_LESSON, WRONG_LESSON } from "./lesson-rules";
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
{"lessons": Item[], "user": Item[], "skill": null | {"name": string, "description": string, "steps": string[]}}
Item is {"text": string, "replaces": string | null}.

You are shown what is ALREADY saved (lessons with their ids, and the facts about the user). Before returning anything, compare with it:
- Already saved, in any words or any language: return nothing for it. Saving the same thing twice is a mistake.
- It refines, corrects or extends a saved entry ("likes apples" -> "likes green apples"): return ONE merged text and set "replaces" to that lesson's id (for a user fact: the exact saved fact). Never add a second entry about the same thing.
- Two saved entries say almost the same: return one merged text that replaces one of them.
- New: "replaces" is null.
Write each text in the language of the user's request.

lessons: usually none. A lesson is worth saving only when it is about THIS USER's work and will change what the bots do for them again: what the user corrected or asked for from now on, where their things are, how they want a recurring kind of job done, which source or person is right for their business. At most 1 lesson (2 when the user corrected the bots), max 200 characters each. Good: "The user's company files are in the Reports folder; check there first." "For m3ak prospect lists, the user wants a phone number for every row, in an Excel file." Not lessons, never save them: how oovi's own tools behave or fail (search snippets, pages that didn't load, tool names, errors, limits, retries); how the team should organise itself; generic advice ("be thorough", "double-check", "announce progress"); a detail of this one task; something the bots simply did normally; anything secret. When the work went fine and the user corrected nothing, the right answer is no lesson.
If the user corrected the bots or gave feedback, the most important lesson is what to do differently. When the user contradicts the bots (for example "it works, it just takes time to load"), the user is right: never save the bots' mistaken conclusion.
Never turn a guess about why something failed into a lesson ("the site is down", "the tunnel is offline", "the link expired") unless an error message proved it: a blank, slow or still-loading page proves nothing. Never save a lesson that tells bots to give up, stop retrying, skip checking or avoid a site ("use another source instead of X", "X has no phone numbers"): a tool that returned nothing once proves nothing about the site. A lesson may say which way WORKED.
user: 0-1 fact about the user, and only one that will matter in many future tasks: who they are, their business, a lasting preference (format, tone, tools), the people they work with. The profile is small, so keep only the most important things: not the details of the current task. Only if clearly shown. Never record which language the user wrote in (they switch languages); only an explicit request like "always answer me in French".
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

/** Lessons and facts come back as {text, replaces} (a plain string still works). */
const items = (v: unknown, max: number): { text: string; replaces?: string }[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? { text: x } : x && typeof x === "object" ? { text: (x as { text?: unknown }).text, replaces: (x as { replaces?: unknown }).replaces } : { text: "" }))
    .filter((x): x is { text: string; replaces: unknown } => typeof x.text === "string" && x.text.trim().length > 0)
    .map((x) => ({ text: clean(x.text), ...(typeof x.replaces === "string" && x.replaces.trim() ? { replaces: x.replaces.trim() } : {}) }))
    .slice(0, max);

/** A lesson the review merged into an existing one: the text changes, and it counts as learned again. */
function replaceLesson(id: string, text: string, entryId?: string): Lesson | null {
  const t = clean(text);
  if (t.length < 12 || SUSPICIOUS.test(t) || WRONG_LESSON.test(t)) return null;
  const lessons = listLessons();
  const l = lessons.find((x) => x.id === id);
  if (!l) return null;
  l.text = t;
  l.score += 1;
  l.updatedAt = Date.now();
  if (entryId) l.entryId = entryId;
  writeLessons(lessons);
  return l;
}

/** What the review compares against: the lessons closest to this work, and the user's profile. */
function savedContext(request: string, work: string): string {
  const near = relevantLessons(`${request} ${work}`.slice(0, 6000), 15);
  const recent = listLessons().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
  const lessons = [...new Map([...near, ...recent].map((l) => [l.id, l])).values()].slice(0, 20);
  const facts = readEntries("user");
  return [
    "Already saved lessons (id: text):",
    ...(lessons.length ? lessons.map((l) => `${l.id}: ${l.text}`) : ["(none)"]),
    "",
    "Already saved facts about the user:",
    ...(facts.length ? facts.map((f) => `- ${f}`) : ["(none)"]),
  ].join("\n");
}

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
  const did = describeWork(input.work);
  parts.push(`What the bots did:\n${did}`);
  parts.push(savedContext(input.request, did));
  if (input.feedback) parts.push(`User feedback on the final answer: ${input.feedback.rating === "up" ? "👍 good" : "👎 not good"}${input.feedback.note ? `: "${input.feedback.note.slice(0, 600)}"` : ""}`);
  const timeout = AbortSignal.timeout(45_000);
  const out = await complete(s, REFLECT_SYSTEM, [{ role: "user", content: parts.join("\n\n") }], [], signal ? AbortSignal.any([signal, timeout]) : timeout, { effort: "low" });
  const j = parseJson(out.text);
  if (!j) return null;

  const source: Lesson["source"] = input.feedback ? "feedback" : "reflection";
  // Technical notes about oovi's own tools aren't lessons about the user's work (the model is told so; this makes sure).
  const saved = items(j.lessons, 3)
    .filter((x) => input.feedback || !TECHNICAL_LESSON.test(x.text))
    .slice(0, input.feedback || input.previous ? 2 : 1)
    .map((x) => (x.replaces && replaceLesson(x.replaces, x.text, last.entry.id)) || addLesson(x.text, { botId: last.bot.id, source, entryId: last.entry.id }))
    .filter((l): l is Lesson => !!l);
  // The same lesson returned twice (or merged into one) shows once.
  const kept = [...new Map(saved.map((l) => [l.id, l])).values()];
  const lessons = kept.map((l) => l.text);
  const lessonIds = kept.map((l) => l.id);
  const user: string[] = [];
  // Facts "about the user" only when the user wrote the request (not another person in a shared Telegram group).
  const fromSomeoneElse = /^\[[^\]]{1,60} on Telegram\]/.test(input.request.trim());
  if (!fromSomeoneElse) {
    for (const x of items(j.user, 1)) {
      // A fact that refines a saved one replaces it ("likes apples" -> "likes green apples"); else it's added.
      const replaced = !!x.replaces && /^Updated/.test(applyMemory("replace", "user", x.text, x.replaces));
      if (replaced || /^Saved/.test(applyMemory("add", "user", x.text))) user.push(x.text);
    }
  }

  let skill: LearnedNote["skill"];
  const sk = j.skill as { name?: unknown; description?: unknown; steps?: unknown } | null;
  if (sk && typeof sk.name === "string" && typeof sk.description === "string") {
    const steps = strings(sk.steps, 10);
    if (steps.length >= 2 && !SUSPICIOUS.test(steps.join(" "))) {
      skill = { name: clean(sk.name).slice(0, 60), description: clean(sk.description).slice(0, 200), body: steps.map((x, i) => `${i + 1}. ${x}`).join("\n") };
    }
  }
  if (!lessons.length && !user.length && !skill) return null;
  return { lessons, lessonIds, user, ...(skill ? { skill } : {}), at: Date.now() };
}

/** Merge a new note into what a reply already learned. */
export function mergeLearned(a: LearnedNote | undefined, b: LearnedNote): LearnedNote {
  if (!a) return b;
  const uniq = (xs: string[]) => [...new Set(xs)].slice(-6);
  // Lessons keep their ids; one that was updated (same id) shows its newest text once.
  const pairs = new Map<string, { text: string; id?: string }>();
  for (const n of [a, b]) n.lessons.forEach((text, i) => pairs.set(n.lessonIds?.[i] ?? `t:${text}`, { text, id: n.lessonIds?.[i] }));
  const last = [...pairs.values()].slice(-6);
  return { lessons: last.map((x) => x.text), lessonIds: last.map((x) => x.id ?? ""), user: uniq([...a.user, ...b.user]), skill: b.skill ?? a.skill, skillSaved: a.skillSaved, at: b.at };
}

/**
 * The user edits or removes something on a reply's "Learned" card: the saved lesson (or the fact in
 * their profile) changes with it. Returns the card's new content, or an error message.
 */
export function changeLearned(note: LearnedNote, kind: "lesson" | "user", index: number, action: "remove" | "edit", textIn?: string): LearnedNote | string {
  const list = kind === "lesson" ? note.lessons : note.user;
  const old = list[index];
  if (old === undefined) return "That line is no longer on the card.";
  const text = clean(textIn ?? "");
  if (action === "edit" && text.length < 3) return "Write what it should say.";
  if (action === "edit" && SUSPICIOUS.test(text)) return "That can't be saved: it looks like an instruction or a secret.";
  const next: LearnedNote = { ...note, lessons: [...note.lessons], lessonIds: note.lessons.map((_, i) => note.lessonIds?.[i] ?? ""), user: [...note.user] };
  if (kind === "lesson") {
    // Cards from before ids were kept: find the lesson by its text.
    const id = next.lessonIds![index] || listLessons().find((l) => l.text === old)?.id || "";
    if (action === "remove") {
      if (id) deleteLesson(id);
      next.lessons.splice(index, 1);
      next.lessonIds!.splice(index, 1);
    } else {
      // The lesson may be gone meanwhile (removed in Settings): the corrected text is saved as a new one.
      const saved = (id && editLesson(id, text)) || addLesson(text, { source: "feedback" });
      if (!saved) return "Couldn't save that lesson.";
      next.lessons[index] = saved.text;
      next.lessonIds![index] = saved.id;
    }
    return next;
  }
  if (action === "remove") {
    applyMemory("remove", "user", undefined, old); // already gone from the profile: the card line goes anyway
    next.user.splice(index, 1);
    return next;
  }
  const r = applyMemory("replace", "user", text, old);
  if (!/^Updated/.test(r)) {
    // No longer in the profile (edited in Settings meanwhile): save the corrected fact as a new one.
    const added = applyMemory("add", "user", text);
    if (!/^(Saved|Already)/.test(added)) return added;
  }
  next.user[index] = text;
  return next;
}
