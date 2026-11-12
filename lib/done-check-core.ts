// The done-check: after a bot's working turn, is what the user asked for really finished?
// Any kind of task (a list, research, a document, a desktop task, code): oovi doesn't guess from the
// request's wording ("50", "list") whether a task is long; it looks at what was asked and what was
// delivered, and continues by itself while the bot could go on alone. Pure: tests/unit/done-check.test.mts.

export type Verdict = { status: "done" | "needs_user" | "unfinished"; missing: string; goal: string };

export const DONE_CHECK_SYSTEM = [
  "You check whether an AI assistant has finished what the user asked, before its reply goes to the user. Reply with one JSON object and nothing else.",
  '{"status": "done" | "needs_user" | "unfinished", "missing": "what is still to do, in one or two concrete sentences (empty when done)", "goal": "what the finished result is, in one sentence, in English"}',
  "unfinished: some of what the user asked is not done yet (a part, a step, the quantity they asked for, the file or the action itself) and the assistant could go on by itself: it delivered a partial result, stopped early, offered or promised to continue (\"I can continue\", \"next I will…\", \"je peux relancer\"), asked whether it should continue, gave the user a step it could do itself, or gave up after only a few attempts.",
  "needs_user: it can't go on without the user: a decision or choice only they can make, information only they have, a password, a code, a sign-in, an approval, or something only a person can do. A plain request for permission to continue is NOT needs_user: that is unfinished.",
  "done: everything asked is delivered; or it is truly impossible and the reply says so plainly after real, varied attempts. Small talk, a question answered, a short request handled: done.",
  "Judge only from what is shown. Don't judge quality or style. When in doubt between done and unfinished, choose done.",
].join("\n");

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** What the check reads: the request, the job's goal if there is one, what the turn did, and the reply. */
export function doneCheckInput(o: { request: string; goal?: string; activity: string; reply: string; missingBefore?: string }): string {
  return [
    `The user's request:\n${cut(o.request.trim(), 3000)}`,
    o.goal ? `The goal set for this work: ${cut(o.goal, 400)}` : "",
    o.missingBefore ? `Still missing after the previous round: ${cut(o.missingBefore, 400)}` : "",
    `What the assistant did in this turn (tools used, files and tables):\n${cut(o.activity, 1500) || "(no tools)"}`,
    `The assistant's reply to the user:\n${cut(o.reply.trim(), 3000) || "(empty)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The check's answer, or null when it isn't clear (then nothing is continued: never loop on a guess). */
export function parseVerdict(text: string): Verdict | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const status = j.status;
    if (status !== "done" && status !== "needs_user" && status !== "unfinished") return null;
    const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 500) : "");
    const missing = str(j.missing);
    // "Unfinished" without saying what is missing can't be acted on.
    if (status === "unfinished" && missing.length < 5) return null;
    return { status, missing, goal: str(j.goal) };
  } catch {
    return null;
  }
}

/** Two "still missing" notes that say the same thing: the rounds stopped moving the work forward. */
export function sameMissing(a: string | undefined, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3));
  if (!a) return false;
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.max(x.size, y.size) >= 0.8;
}
