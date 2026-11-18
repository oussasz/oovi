// A reply that ends by announcing work it didn't do ("I'll search now", "je vais chercher", "سأبحث الآن",
// "راني نحوس") is caught by plain text rules, before the paid done-check: the bot is sent back once to do it.
// Pure: tests/unit/promise.test.mts. Only the end of the reply counts, and anything that waits for the user
// (a question, "let me know", "if you want…") is never a promise.

const FUTURE = [
  // English
  /\b(i'll|i will|i'm going to|i am going to|let me|now i'll|next,? i'll|i'll now|starting now|on it)\b/i,
  // French
  /\b(je vais|je m'en occupe|je lance|je commence|laisse[- ]moi|laissez[- ]moi|je m'y mets|je reviens (vers vous|avec))\b/i,
  // Arabic (standard)
  /(سأقوم|سأبدأ|سأبحث|سأرسل|سأعمل|سأجهز|سأكتب|سأتحقق|سوف أ|دعني|الآن أبدأ|سأعود)/,
  // Algerian Darija
  /(راني ن|درك ن|دركا ن|دروك ن|ضرك ن|خليني ن|توا ن|نبدا (درك|دركا|دروك)|نروح ن)/,
  // Darija in Latin letters ("rani nhawes", "drok nb3at")
  /\b(rani|drok|dork|dorka|derk|khalini|tawa|ghadi|rayeh)\s+n[a-z23579]/i,
];

const WAITS_FOR_USER = [
  /\?\s*$|؟\s*$/,
  /\b(let me know|tell me|if you (want|like|prefer|need)|would you|should i|do you want|keep you (posted|updated)|i'll wait|waiting for your)\b/i,
  /\b(dites[- ]moi|dis[- ]moi|si vous (voulez|souhaitez|préférez)|si tu veux|voulez-vous|veux-tu|j'attends|je reste (disponible|à votre))\b/i,
  /(إذا (أردت|تريد|كنت)|هل تريد|أخبرني|في انتظار|أنتظر)/,
  /(ايلا حبيت|إلا حبيت|قولي|نستنى|راني نستنى|كي تحب)/,
  /\b(ila 7abit|ila habit|ida 7abit|golili|goulili|9olli|9oli|nestena|nstenna|ki t7eb|ki theb)\b/i,
];

/** The last sentence of the reply (or its last line), trimmed. */
export function lastSentence(text: string): string {
  const t = String(text ?? "").trim().replace(/[\s*_`>]+$/g, "");
  const line = t.split(/\n+/).filter((l) => l.trim()).at(-1) ?? "";
  const parts = line.split(/(?<=[.!?؟…])\s+/).filter((p) => p.trim());
  return (parts.at(-1) ?? line).trim();
}

/** The sentence the reply ends on, when it announces work the bot didn't do; otherwise null. */
export function endsOnPromise(text: string): string | null {
  const last = lastSentence(text);
  if (!last || last.length > 300) return null;
  if (WAITS_FOR_USER.some((r) => r.test(last))) return null;
  return FUTURE.some((r) => r.test(last)) ? last : null;
}

/** What the bot is told when it stopped on a promise. */
export const promiseMissing = (sentence: string) =>
  `The reply ended with "${sentence.slice(0, 200)}" but nothing was done after it: do that now with your tools, then answer with the result (or say plainly why it can't be done).`;
