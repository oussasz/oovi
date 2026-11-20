// When does a new message mean "go on with the job that stopped"? A job that ended before its goal waits a
// day for the user. Every message written in that day used to be read as "continue it" (with the old goal
// and "don't ask, keep working" added to the bot's instructions), so a new request was answered with old
// work. Only a short message that says to go on does that now; anything else is a request of its own.
// Pure: tests/unit/resume-core.test.mts.

/** A whole word, for letters with accents too (\b stops at "é"). */
const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(${alternatives})(?![\\p{L}\\p{N}])`, "iu");

/** Words that only mean "go on with it" (or "try it again"). */
const GO_ON = [
  word("retry|re-?try|try again|continue|go on|keep going|carry on|resume|proceed|finish it"),
  word("r[ée]essa(ie|yer|ye|yez)|continue[rz]?|reprends?|termine"),
  /(كم[ّ]?ل|واصل|عاود|استمر|أكمل|اكمل|جرب مرة|جرّب مرة)/,
  word("kemm?el|kamel|wasel|3awed|aawed"),
];

/** Words that mean it only when they are the whole message ("ok", "it works now", "connected"). */
const ACK = [
  word("again|go ahead|do it|ok(ay)?|yes|yep|sure|done|fixed|it works( now)?|connected|ready"),
  word("vas-?y|allez|c'est bon|c bon|d'accord|oui|connect[ée]e?|fait|pr[êe]t"),
  /(زيد|جرب|جرّب|أيه|ايه|نعم|تمام|ربطت|راهو يخدم|خدام|صحا|ماشي)/,
  word("zid|ih|wah|saha|khdam"),
];

/**
 * Whether a message says to go on with the job that stopped: a few words that say so or that what blocked
 * it is fixed ("ok", "connecté", "كمل"), or a longer message that starts with a clear word to go on ("retry,
 * I fixed the wifi"). Anything else is a request of its own. When it resumes, the bot still reads the
 * message: one that asks for something else is answered for itself (the job's instructions say so).
 */
export function resumesJob(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  const words = t.split(/\s+/);
  if (words.length <= 5 && t.length <= 40) return [...GO_ON, ...ACK].some((r) => r.test(t));
  const start = words.slice(0, 4).join(" ");
  return GO_ON.some((r) => r.test(start));
}
