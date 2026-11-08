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
