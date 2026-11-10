// Advanced Telegram: extra Telegram chats (usually Telegram groups) linked to oovi groups.
// Pure routing rules with no imports from the rest of oovi, so they can be tested with a
// fake Telegram update and no bot token.
//
// Telegram facts these rules rely on (core.telegram.org/bots/features#privacy-mode):
// - Group and supergroup chat IDs are negative (supergroups look like -100…); private chats are positive.
// - With privacy mode on (the default), a bot in a group only receives commands meant for it
//   (/cmd@this_bot, or /cmd when it was the last bot to post), replies to its own messages and
//   service messages. Bots that are group admins, or with privacy turned off in @BotFather
//   (/setprivacy, then re-add the bot), receive every message.
// So in group chats we answer only messages addressed to the bot: an @mention, a reply to the
// bot, or one of our commands. Everything else is ignored.

export type TgLink = { chatId: number; groupId: string; label: string; at: number };
export type TgDetected = { chatId: number; title: string; type: string; at: number };

type TgUser = { id?: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
export type TgMessage = {
  message_id?: number;
  chat: { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string };
  from?: TgUser;
  text?: string;
  reply_to_message?: { from?: TgUser };
  new_chat_members?: TgUser[];
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
};
export type TgUpdate = { update_id: number; message?: TgMessage };

/** A Telegram chat ID typed by the user: an integer, negative for groups (e.g. -1001234567890), positive for private chats. */
export function parseChatId(raw: unknown): number | null {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(/[\s−]/g, (c) => (c === "−" ? "-" : "")) : "";
  if (!/^-?[1-9]\d{0,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** A short, plain label (no control characters). */
export function cleanLabel(raw: unknown, max = 48): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function chatTitle(chat: TgMessage["chat"]): string {
  const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.username ? `@${chat.username}` : "");
  return cleanLabel(name, 64) || String(chat.id);
}

const isGroupType = (type: string) => type === "group" || type === "supergroup";
const sameName = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Our commands. Bare commands in a group count as addressed to us (Telegram only delivers them when we posted last, or when privacy is off). */
const COMMANDS = new Set(["start", "yes", "no", "ask"]);

/**
 * Normalize a message addressed to this bot: "/yes@my_bot always" → "/yes always",
 * "@my_bot what's new?" → "what's new?", "/ask@my_bot hi" → "hi".
 * Returns null when a group message isn't for us (no mention, no reply, not our command).
 */
export function addressedText(m: TgMessage, botUsername?: string): string | null {
  const raw = (m.text ?? "").trim();
  if (!isGroupType(m.chat.type)) return raw;
  const cmd = raw.match(/^\/(\w+)(?:@(\w+))?(?:\s+([\s\S]*))?$/);
  if (cmd) {
    const [, name = "", at, rest = ""] = cmd;
    if (at && !sameName(at, botUsername)) return null; // a command for another bot
    if (!at && !COMMANDS.has(name.toLowerCase())) return null;
    if (name.toLowerCase() === "ask") return rest.trim();
    return `/${name}${rest ? ` ${rest.trim()}` : ""}`;
  }
  const replyToMe = !!m.reply_to_message?.from?.is_bot && sameName(m.reply_to_message.from.username, botUsername);
  const mention = botUsername ? new RegExp(`(^|[^\\w@])@${esc(botUsername)}\\b`, "i") : null;
  const mentioned = !!mention && mention.test(raw);
  if (!replyToMe && !mentioned) return null;
  const text = mention ? raw.replace(new RegExp(`(^|[^\\w@])@${esc(botUsername ?? "")}\\b[,:]?`, "gi"), "$1") : raw;
  return text.replace(/\s+/g, " ").trim();
}

export type Route =
  | { kind: "ignore" }
  /** The paired main chat, or the pairing flow (no main chat yet): today's behaviour, talks to the Chief. */
  | { kind: "main" }
  /** A linked chat: the message goes to that oovi group. */
  | { kind: "linked"; link: TgLink; text: string }
  /** Telegram moved a linked group to a new ID (group upgraded to a supergroup). */
  | { kind: "migrate"; from: number; to: number }
  /** A chat nobody linked yet: listed in Settings > Telegram > Advanced; it gets at most one short "not linked yet" reply, ever. */
  | { kind: "unknown"; chatId: number; title: string; type: string };

export type RouteContext = { mainChatId?: number; links: TgLink[]; botUsername?: string };

export function routeUpdate(u: TgUpdate, ctx: RouteContext): Route {
  const m = u.message;
  if (!m || typeof m.chat?.id !== "number" || !Number.isSafeInteger(m.chat.id)) return { kind: "ignore" };
  const { id, type } = m.chat;
  if (type !== "private" && !isGroupType(type)) return { kind: "ignore" }; // channels
  if (m.from?.is_bot) return { kind: "ignore" }; // other bots (and never ourselves)

  // Supergroup upgrade: Telegram itself sends these service messages, so they can be trusted.
  const linked = (cid: number) => ctx.links.find((l) => l.chatId === cid);
  if (typeof m.migrate_to_chat_id === "number" && linked(id)) return { kind: "migrate", from: id, to: m.migrate_to_chat_id };
  if (typeof m.migrate_from_chat_id === "number" && linked(m.migrate_from_chat_id) && !linked(id)) return { kind: "migrate", from: m.migrate_from_chat_id, to: id };

  if (type === "private" && (ctx.mainChatId === undefined || id === ctx.mainChatId) && !linked(id)) return { kind: "main" };

  const link = linked(id);
  if (link) {
    const text = addressedText(m, ctx.botUsername);
    return text === null ? { kind: "ignore" } : { kind: "linked", link, text };
  }

  // Unknown chat. In a group: only note it when we were added or addressed (a private chat is always addressed).
  const addedMe = !!m.new_chat_members?.some((x) => x.is_bot && sameName(x.username, ctx.botUsername));
  if (isGroupType(type) && !addedMe && addressedText(m, ctx.botUsername) === null) return { kind: "ignore" };
  return { kind: "unknown", chatId: id, title: chatTitle(m.chat), type };
}

export type ApprovalItemLike = { call: { id: string }; folder?: string; always?: boolean };
export type ApprovalInput = { decisions: Record<string, boolean>; alwaysFolders?: boolean; alwaysEdit?: boolean };

// A whole message that is just "yes" or "no", in the languages oovi speaks (and Algerian
// Arabic). Only used while something waits for the user's answer, so "ok" in a normal
// conversation stays a normal message. Words that mean yes in one dialect and no in
// another (e.g. "ماشي") are left out.
const YES_WORDS = new Set(["yes", "y", "yep", "yeah", "ok", "okay", "sure", "allow", "approve", "oui", "ouais", "d'accord", "daccord", "sí", "si", "vale", "ja", "evet", "tamam", "نعم", "ايه", "إيه", "اي", "أي", "واه", "موافق", "اوكي", "أوكي"]);
const NO_WORDS = new Set(["no", "n", "nope", "deny", "cancel", "non", "nein", "hayır", "hayir", "لا", "لالا", "بلاش"]);

/** true for a plain yes, false for a plain no, null for anything else. */
export function yesNo(text: string): boolean | null {
  const w = text
    .trim()
    .toLowerCase()
    .replace(/[\s.!؟?،,]+$/u, "")
    .replace(/^[\s.!¡¿]+/u, "");
  if (!w || w.length > 12) return null;
  if (YES_WORDS.has(w) || w === "👍") return true;
  if (NO_WORDS.has(w) || w === "👎") return false;
  return null;
}

/** An answer to a waiting plan: "/yes", "/no", or (words: shown in this chat) a plain yes/no word. null: anything else (asks for changes). */
export function planAnswer(text: string, words = false): boolean | null {
  if (/^\/(yes|no)\b/i.test(text)) return /^\/yes/i.test(text);
  return words ? yesNo(text) : null;
}

/**
 * "/yes", "/no", "/yes always" → the decisions for a pending approval. words: also a plain
 * yes/no word, allowed only when the request was shown in this Telegram chat (so "ok" never
 * approves something the user didn't see here).
 */
export function approvalCommand(text: string, pending?: { items: ApprovalItemLike[] }, words = false): { kind: "none" } | { kind: "nothing-pending" } | { kind: "decide"; input: ApprovalInput; word?: true } {
  const command = /^\/(yes|no)\b/i.test(text);
  const word = command || !words ? null : yesNo(text);
  if (!command && (word === null || !pending)) return { kind: "none" };
  if (!pending) return { kind: "nothing-pending" };
  const ok = command ? /^\/yes/i.test(text) : word === true;
  // "/yes always": also remember the folder (files on this computer) or allow edits (project folder).
  const always = ok && /^\/yes\s+always\b/i.test(text);
  return {
    kind: "decide",
    input: {
      decisions: Object.fromEntries(pending.items.map((i) => [i.call.id, ok])),
      ...(always ? { alwaysFolders: pending.items.some((i) => !!i.folder), alwaysEdit: pending.items.some((i) => !!i.always) } : {}),
    },
    ...(command ? {} : { word: true as const }),
  };
}

/**
 * Who may answer approvals in a linked chat: in a Telegram group, only the owner (the
 * Telegram account paired as the main chat; a private chat's ID is that user's ID).
 * In a linked private chat, the person in it.
 */
export function canApprove(m: TgMessage, link: TgLink, mainChatId?: number): boolean {
  const from = m.from?.id;
  if (typeof from !== "number") return false;
  if (m.chat.type === "private") return from === link.chatId || from === mainChatId;
  return mainChatId !== undefined && from === mainChatId;
}
