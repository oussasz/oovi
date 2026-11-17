// Long answers that hit the model's length limit are continued instead of arriving cut: the bot is asked to
// go on from where it stopped, and the two parts are joined without the words it repeated. Pure:
// tests/unit/continue.test.mts.

export const CONTINUE_CUT =
  "[oovi]: your last answer reached the length limit for one answer and was cut in the middle. Continue it exactly where it stopped: start with the very next words (mid-sentence if needed), don't repeat anything, don't start over, don't say that you are continuing. Same language and format.";

/** Up to this many continuations per answer. */
export const MAX_CONTINUE = 2;

/** The two parts joined: words the second part repeats from the end of the first are dropped. */
export function joinCut(first: string, next: string): string {
  const a = first;
  const b = next.replace(/^\s+/, "");
  if (!b) return a;
  // The longest end of `a` (at least 12 characters) that `b` starts with.
  const max = Math.min(a.length, b.length, 400);
  for (let n = max; n >= 12; n--) if (b.startsWith(a.slice(a.length - n))) return a + b.slice(n);
  // A part that started over from the beginning: keep only what's new after the first part's text.
  const head = a.slice(0, 60);
  if (head.length >= 20 && b.startsWith(head)) {
    const at = b.indexOf(a.slice(-40));
    if (at >= 0) return a + b.slice(at + 40);
  }
  // Joined where the cut was: inside a word or after a space, no extra space; between sentences, a space.
  // The model's next words usually carry their own leading space: keep it (once).
  if (/^\s/.test(next) && !/\s$/.test(a)) return `${a} ${b}`;
  const glue = /[\s(\[«"'\-/]$/.test(a) || /^[\s.,;:!?)\]»%]/.test(b) || /\p{L}$/u.test(a) ? "" : " ";
  return a + glue + b;
}
