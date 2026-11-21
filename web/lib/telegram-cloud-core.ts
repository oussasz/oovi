// Telegram while the computer is off: a message from the user's paired Telegram chat becomes a cloud job in the main
// bot's chat, answered by oovi's cloud server like a phone message (the runner sends the reply back to Telegram).
// Before, the user got "open oovi on your computer" and waited up to a day. Pure: tests/unit/telegram-cloud.test.mts.

export type TelegramCloudCheck = {
  /** The computer hasn't collected Telegram messages for a while (web/lib/telegram-relay.ts OFFLINE_AFTER_MS). */
  relayOffline: boolean;
  /** A desktop of the account was seen in the last minute (the runner's own rule: it would take the job instead). */
  desktopOnline: boolean;
  /** oovi's cloud server asked for work recently. */
  serverUp: boolean;
  syncOn: boolean;
  tgChatId: number | undefined;
  /** The user's own Telegram chat paired with oovi (a linked group chat stays with the computer). */
  pairedChatId: number | undefined;
  /** oovi's main bot chat ("dm-<botId>"), sent by the desktop; "" from an older app. */
  mainChat: string;
  text: string;
  /** A voice note: turning it into text needs the computer's keys. */
  voice: boolean;
  updateId: number;
  /** The last update handed to the cloud (Telegram sends an update again when its webhook isn't answered fast). */
  lastHanded: number;
};

export type TelegramCloudPayload = { text: string; entryId: string; channel: "telegram"; telegramChatId: number };

export function telegramToCloud(c: TelegramCloudCheck): { cloud: true; chatId: string; payload: TelegramCloudPayload } | { cloud: false } {
  const text = c.text.trim();
  if (!c.relayOffline || c.desktopOnline || !c.serverUp || !c.syncOn) return { cloud: false };
  if (typeof c.tgChatId !== "number" || c.tgChatId !== c.pairedChatId) return { cloud: false };
  if (!/^dm-[\w-]{1,40}$/.test(c.mainChat)) return { cloud: false };
  if (c.voice || !text || /^\/start\b/.test(text)) return { cloud: false };
  if (!Number.isFinite(c.updateId) || c.updateId <= c.lastHanded) return { cloud: false };
  return { cloud: true, chatId: c.mainChat, payload: { text: text.slice(0, 20_000), entryId: `tg${c.updateId}`, channel: "telegram", telegramChatId: c.tgChatId } };
}
