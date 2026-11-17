// Private experts (CatalogPlugin.protected): what a bot added from one must look like right now.
// Pure (no files, no network): tests/unit/experts.test.mts. The part that reads and writes is lib/experts.ts.

export type ExpertBot = { id: string; role: string; about?: string; instructions: string; expert?: string };
export type ExpertItem = { id: string; protected?: boolean; bots: { role: string; about?: string; instructions: string }[] };
export type InstalledItem = { id: string; botIds: string[] };
export type Change = { botId: string; set: { role: string; about?: string; instructions: string; expert: string } } | { botId: string; unlock: true };

/**
 * The changes that bring the user's bots in step with the catalog:
 * - a bot added from a private expert takes its role, description and instructions from the catalog and is marked as that expert's;
 * - a bot whose item is no longer private is unlocked (it keeps its text, the user can edit it again);
 * - an item missing from the catalog (offline, unpublished) changes nothing: the bot keeps what it had.
 * `prompt` gives the built-in text when the catalog item carries none.
 */
export function expertChanges(bots: ExpertBot[], installed: InstalledItem[], items: ExpertItem[], prompt: (itemId: string, index: number) => string): Change[] {
  const out: Change[] = [];
  const byId = new Map(bots.map((b) => [b.id, b]));
  const linked = new Set<string>();
  for (const inst of installed) {
    const item = items.find((p) => p.id === inst.id);
    if (!item) {
      for (const id of inst.botIds) linked.add(id);
      continue;
    }
    inst.botIds.forEach((botId, i) => {
      const bot = byId.get(botId), src = item.bots[i];
      if (!bot || !src) return;
      linked.add(botId);
      if (!item.protected) {
        if (bot.expert) out.push({ botId, unlock: true });
        return;
      }
      const instructions = (src.instructions || prompt(item.id, i)).trim();
      if (!instructions) return; // nothing to give it: leave the bot alone rather than empty it
      const about = src.about?.trim() || undefined;
      if (bot.expert !== item.id || bot.role !== src.role || (bot.about ?? undefined) !== about || bot.instructions !== instructions) {
        out.push({ botId, set: { role: src.role, ...(about ? { about } : {}), instructions, expert: item.id } });
      }
    });
  }
  // A locked bot that belongs to no installed item any more (its record was lost): unlock it.
  for (const b of bots) if (b.expert && !linked.has(b.id)) out.push({ botId: b.id, unlock: true });
  return out;
}

/** What the app's screens may know about a bot: a private expert's instructions never leave the server. */
export function forScreens<T extends { expert?: string; instructions: string }>(bot: T): T {
  return bot.expert ? { ...bot, instructions: "" } : bot;
}
