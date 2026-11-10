// @mentions are how the user and bots route work in a group.

/** Bot names are one word so they can be @mentioned. */
export const NAME_RE = /^[\p{L}\p{N}_-]{1,24}$/u;
export const MENTION_RE = /@([\p{L}\p{N}_-]+)/gu;

type Named = { id: string; name: string };

/** Bot ids mentioned in `text`, in order, without duplicates. "@all" / "@everyone" = all members. */
export function findMentions(text: string, members: Named[]): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const handle = (m[1] ?? "").toLowerCase();
    const ids = handle === "all" || handle === "everyone" ? members.map((b) => b.id) : members.filter((b) => b.name.toLowerCase() === handle).map((b) => b.id);
    for (const id of ids) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The teammates a bot's message actually hands the turn to. A plain @mention isn't enough:
 * "@mouloud a raison", "Merci @c" or "as @Scout wrote" only refer to someone. A mention hands off when
 * - it addresses them: it starts its sentence ("@Lina, write the post", "@A and @B, please check"), or
 * - its sentence is a question ("Can you check the link, @c?").
 * A teammate who already replied to this request gets the turn back only for a question, so two bots
 * can't bounce agreement back and forth.
 */
export function handoffMentions(text: string, members: Named[], replied: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  // Sentences end at . ! ? … ؟ or a line break; the end mark stays with its sentence.
  const sentences = text.match(/[^.!?…؟\n]+[.!?…؟]*/gu) ?? [];
  for (const sentence of sentences) {
    const question = /[?؟]\s*$/u.test(sentence);
    for (const m of sentence.matchAll(MENTION_RE)) {
      const before = sentence.slice(0, m.index).replace(/^[\s>*_\-•\d.)]+/u, "");
      const addressed = /^(?:\s|,|&|@[\p{L}\p{N}_-]+|and|et|ou|or|y|و)*$/iu.test(before);
      for (const id of findMentions(m[0], members)) {
        if (out.includes(id)) continue;
        if (question || (addressed && !replied.has(id))) out.push(id);
      }
    }
  }
  return out;
}
