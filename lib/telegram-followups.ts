// A request that was shown on Telegram but answered in the app: the user is still waiting on
// Telegram, so the bot's final reply is sent there too when the run ends (lib/telegram.ts reads this).
// Kept in memory only: after a restart, the reply is in oovi as usual.

type FollowUp = { telegramChatId: number; entryId: string; at: number };
const g = globalThis as typeof globalThis & { __ooviTgFollowUps?: Map<string, FollowUp> };
const map = () => (g.__ooviTgFollowUps ??= new Map());

export function addTelegramFollowUp(ooviChatId: string, telegramChatId: number, entryId: string): void {
  map().set(ooviChatId, { telegramChatId, entryId, at: Date.now() });
}

/** The follow-up for a chat whose run just ended (removed once taken). Older than a day: dropped. */
export function takeTelegramFollowUp(ooviChatId: string): FollowUp | null {
  const f = map().get(ooviChatId);
  map().delete(ooviChatId);
  return f && Date.now() - f.at < 24 * 60 * 60 * 1000 ? f : null;
}
