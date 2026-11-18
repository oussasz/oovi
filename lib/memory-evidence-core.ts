// A fact saved about the user must come from what the user said: its words mostly appear in their own
// messages, and any number, email or web address in it appears there exactly. So a bot can't "remember" a
// guess, or something a web page claimed about them. Plain word rules (any language). Pure:
// tests/unit/memory-evidence.test.mts.

const STOP = new Set(
  "the a an and or of to in on for with is are was be the user user's they them their he she his her likes prefers wants needs uses works lives called name named their my me i we our you your le la les un une des et ou de du en au aux est sont pour avec qui que son sa ses il elle aime préfère veut utilise travaille habite appelle و في من على إلى عن مع هو هي هم يحب يفضل يريد يعمل يسكن اسم المستخدم".split(" "),
);

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ً-ْ]/g, "")
    .split(/[^\p{L}\p{N}@.+-]+/u)
    .map((w) => w.replace(/^[.+-]+|[.+-]+$/g, ""))
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Numbers, emails and links in a text (they must be copied exactly, never guessed). */
const exacts = (s: string) => s.match(/[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/\S+|\+?\d[\d\s.-]{3,}\d/g)?.map((x) => x.replace(/[\s.-]/g, "")) ?? [];

/**
 * null when the fact is backed by the user's words; otherwise why it isn't. Numbers, emails and links must
 * appear exactly in what the user wrote. The other words are not compared: bots often save a fact in another
 * language than the user spoke (Darija heard, English saved), so a word rule would refuse true facts.
 */
export function unbackedFact(fact: string, userSaid: string): string | null {
  const saidCompact = userSaid.toLowerCase().replace(/[\s.-]/g, "");
  for (const x of exacts(fact)) if (!saidCompact.includes(x.toLowerCase())) return `"${x}" isn't in anything the user wrote`;
  return null;
}

/** Share of a fact's words found in what the user wrote (for reviews; never used to refuse a save). */
export function overlap(fact: string, userSaid: string): number {
  const ws = [...new Set(words(fact))];
  if (!ws.length) return 1;
  const saidWords = new Set(words(userSaid));
  return ws.filter((w) => saidWords.has(w)).length / ws.length;
}
