// When does a new message mean "go on with the job that stopped"? A job that ended before its goal waits a
// day for the user. Every message written in that day used to be read as "continue it" (with the old goal
// and "don't ask, keep working" added to the bot's instructions), so a new request was answered with old
// work. Only a short message that says to go on does that now; anything else is a request of its own.
// Pure: tests/unit/resume-core.test.mts.

/** A whole word, for letters with accents too (\b stops at "é"). */
const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(${alternatives})(?![\\p{L}\\p{N}])`, "iu");

const GO_ON = [
  word("retry|re-?try|try again|again|continue|go on|go ahead|keep going|carry on|resume|proceed|do it|finish it|ok(ay)?|yes|yep|sure|done|fixed|it works( now)?|connected|ready"),
  word("r[ée]essa(ie|yer|ye)|continue[rz]?|vas-?y|allez|reprends?|termine|c'est bon|c bon|d'accord|oui|connect[ée]e?|fait|pr[êe]t"),
  /(كم[ّ]?ل|واصل|عاود|زيد|استمر|أكمل|اكمل|جرب|جرّب|أيه|ايه|نعم|تمام|ربطت|راهو يخدم|خدام|صحا|ماشي)/,
  word("kemm?el|kamel|wasel|3awed|aawed|zid|ih|wah|saha|khdam"),
];

/** A message of a few words that says to go on (or that what blocked the job is fixed). */
export function resumesJob(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  // A real request has a subject: more than a handful of words is one, whatever word it starts with.
  if (t.split(/\s+/).length > 5 || t.length > 40) return false;
  return GO_ON.some((r) => r.test(t));
}
