// Messages typed while the bot works are shown as "queued" until the chat holds them. The label used to clear only
// when this window saw the message's live event; a message that started the next run (the bot was on its last
// step) was saved with no window listening, and the label stayed for good (reported on Windows). The saved chat is
// the source of truth: a queued message it holds is no longer queued. Pure: tests/unit/chat-queue.test.mts.

/** The queued messages the chat doesn't hold yet. The same array when nothing changes (no redraw). */
export function pruneQueued<T extends { id: string }>(queued: T[], entries: { id: string }[]): T[] {
  if (!queued.length) return queued;
  const saved = new Set(entries.map((e) => e.id));
  const left = queued.filter((q) => !saved.has(q.id));
  return left.length === queued.length ? queued : left;
}
