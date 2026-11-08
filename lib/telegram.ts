// Talk to your main bot from Telegram while you're away from the computer.
//
// Setup (Settings > Telegram): create a bot with @BotFather, paste its token,
// then press Start in Telegram through the link oovi shows. That link carries a
// one-time code, so only you can pair. oovi then:
// - forwards your Telegram messages to the main bot's chat and replies with its answer,
// - asks for approvals there (/yes or /no),
// - sends the main bot's reports (e.g. "Studio finished").
// It uses long polling: nothing is opened to the internet, and it runs while oovi is open.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isRunning, startRun, subscribe } from "./runner";
import { dataDir, decryptSecret, encryptSecret } from "./settings";
import { dmId, getChat } from "./store";
import { mainBot, onReport } from "./team";
import type { BotEntry } from "./types";

type Stored = { token?: string; botUsername?: string; botName?: string; chatId?: number; userName?: string; pairCode?: string };
export type TelegramStatus = { hasToken: boolean; botUsername?: string; botName?: string; connected: boolean; userName?: string; pairLink?: string; error?: string };

const API = "https://api.telegram.org";
const file = () => path.join(dataDir(), "telegram.json");

function read(): Stored {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as Stored;
  } catch {
    return {};
  }
}

function write(s: Stored) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(s, null, 1), { mode: 0o600 });
}

function token(s: Stored): string | null {
  if (!s.token) return null;
  try {
    return decryptSecret(s.token);
  } catch {
    return null;
  }
}

async function tg<T>(tok: string, method: string, body?: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  const r = await fetch(`${API}/bot${tok}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!j.ok) {
    const err = new Error(j.description || `Telegram answered ${r.status}`) as Error & { code?: number };
    err.code = j.error_code ?? r.status;
    throw err;
  }
  return j.result as T;
}

// ---------- settings ----------

let lastError: string | undefined;

export function status(): TelegramStatus {
  const s = read();
  return {
    hasToken: !!s.token,
    botUsername: s.botUsername,
    botName: s.botName,
    connected: !!s.chatId,
    userName: s.userName,
    pairLink: s.token && !s.chatId && s.botUsername && s.pairCode ? `https://t.me/${s.botUsername}?start=${s.pairCode}` : undefined,
    error: lastError,
  };
}

/** Save a bot token from @BotFather. Checks it with Telegram first. */
export async function connect(rawToken: string): Promise<TelegramStatus> {
  const tok = rawToken.trim();
  if (!/^\d{5,}:[\w-]{30,}$/.test(tok)) throw new Error("That doesn't look like a bot token. It looks like 123456789:ABC-def… and comes from @BotFather.");
  let me: { username?: string; first_name?: string };
  try {
    me = await tg<{ username?: string; first_name?: string }>(tok, "getMe");
  } catch (e) {
    throw new Error(`Telegram didn't accept that token: ${(e as Error).message}`);
  }
  await tg(tok, "deleteWebhook", { drop_pending_updates: true }).catch(() => {});
  write({ token: encryptSecret(tok), botUsername: me.username, botName: me.first_name, pairCode: crypto.randomBytes(6).toString("hex") });
  lastError = undefined;
  startTelegram();
  return status();
}

export function disconnect(): TelegramStatus {
  const s = read();
  const tok = token(s);
  if (tok && s.chatId) void tg(tok, "sendMessage", { chat_id: s.chatId, text: "oovi disconnected this chat. Pair again from oovi's Settings to use it." }).catch(() => {});
  try {
    fs.rmSync(file(), { force: true });
  } catch {
    /* already gone */
  }
  lastError = undefined;
  return status();
}

export async function sendTest(): Promise<void> {
  const s = read();
  const tok = token(s);
  if (!tok || !s.chatId) throw new Error("Pair your Telegram first.");
  const bot = mainBot();
  await tg(tok, "sendMessage", { chat_id: s.chatId, text: `Hi! This is ${bot?.name ?? "oovi"}. Send me a message here any time oovi is open on your computer.` });
}

// ---------- messages ----------

const MAX = 4000;
function chunks(text: string): string[] {
  const out: string[] = [];
  let rest = text.trim() || "(empty reply)";
  while (rest.length > MAX) {
    let cut = rest.lastIndexOf("\n", MAX);
    if (cut < MAX / 2) cut = MAX;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

async function say(tok: string, chatId: number, text: string) {
  for (const part of chunks(text)) await tg(tok, "sendMessage", { chat_id: chatId, text: part, disable_web_page_preview: true });
}

function waitDone(chatId: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = subscribe(chatId, (e) => {
      if (e.type === "done") {
        unsub?.();
        resolve();
      }
    });
    if (!unsub) resolve();
  });
}

/** Run the main bot on a message (or approval) and send back what it said. */
async function relay(tok: string, chatId: number, input: { text?: string; decisions?: Record<string, boolean> }) {
  const bot = mainBot();
  if (!bot) return say(tok, chatId, "You have no bots yet. Create one in oovi first.");
  const id = dmId(bot.id);
  getChat(id); // create the chat if needed
  if (isRunning(id)) return say(tok, chatId, `${bot.name} is still working on your last message. I'll send the answer when it's done.`);
  const before = new Set(getChat(id)?.entries.map((e) => e.id) ?? []);
  const typing = setInterval(() => void tg(tok, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}), 4500);
  void tg(tok, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  try {
    if (!startRun(id, input)) return say(tok, chatId, `${bot.name} is busy. Try again in a moment.`);
    await waitDone(id);
  } finally {
    clearInterval(typing);
  }
  const chat = getChat(id);
  if (!chat) return;
  const fresh = chat.entries.filter((e): e is BotEntry => e.kind === "bot" && (!before.has(e.id) || e.id === chat.pending?.approval?.entryId));
  const last = [...fresh].reverse().find((e) => e.text || e.error);
  if (chat.pending?.approval) {
    const items = chat.pending.approval.items.map((x, i) => `${i + 1}. ${x.summary}${x.detail ? `\n${x.detail.slice(0, 600)}` : ""}`).join("\n");
    return say(tok, chatId, `${bot.name} needs your OK:\n${items}\n\nReply /yes to allow or /no to deny.`);
  }
  if (last?.status === "error") return say(tok, chatId, `${bot.name} hit a problem: ${last.error ?? "unknown error"}`);
  if (last?.text) return say(tok, chatId, last.text);
  return say(tok, chatId, `${bot.name} didn't reply.`);
}

type Update = { update_id: number; message?: { chat: { id: number; type: string }; from?: { first_name?: string; username?: string }; text?: string } };

async function handle(tok: string, u: Update) {
  const m = u.message;
  if (!m || m.chat.type !== "private") return;
  const s = read();
  const text = (m.text ?? "").trim();

  // Pairing: only the person who opened oovi's link (with its one-time code) gets in.
  if (!s.chatId) {
    const code = text.match(/^\/start\s+(\w+)/)?.[1];
    if (code && s.pairCode && code === s.pairCode) {
      write({ ...s, chatId: m.chat.id, userName: m.from?.first_name || m.from?.username, pairCode: undefined });
      const bot = mainBot();
      await say(tok, m.chat.id, `Connected! You're talking to ${bot?.name ?? "your main bot"} in oovi. Ask anything, or ask it to put a group to work. It answers while oovi is open on your computer.`);
    } else {
      await say(tok, m.chat.id, "This is a private oovi bot. To connect, use the link shown in oovi > Settings > Telegram.");
    }
    return;
  }
  if (m.chat.id !== s.chatId) {
    await say(tok, m.chat.id, "This is a private oovi bot.");
    return;
  }

  if (!text) return say(tok, m.chat.id, "I can read text messages for now.");
  if (/^\/start\b/.test(text)) return say(tok, m.chat.id, "You're connected. Send a message to talk to your main bot.");
  const bot = mainBot();
  const pending = bot ? getChat(dmId(bot.id))?.pending?.approval : undefined;
  if (/^\/(yes|no)\b/i.test(text)) {
    if (!pending) return say(tok, m.chat.id, "Nothing is waiting for your OK right now.");
    const ok = /^\/yes/i.test(text);
    return relay(tok, m.chat.id, { decisions: Object.fromEntries(pending.items.map((i) => [i.call.id, ok])) });
  }
  return relay(tok, m.chat.id, { text: text.slice(0, 20_000) });
}

// ---------- long polling ----------

const g = globalThis as typeof globalThis & { __ooviTelegram?: { gen: number; offReport?: () => void } };

/** Start (or restart) listening. Safe to call many times. */
export function startTelegram(): void {
  const state = (g.__ooviTelegram ??= { gen: 0 });
  const gen = ++state.gen;
  state.offReport?.();
  state.offReport = onReport((text) => {
    const s = read();
    const tok = token(s);
    if (tok && s.chatId) void say(tok, s.chatId, text).catch(() => {});
  });
  void (async () => {
    let offset = 0;
    while (state.gen === gen) {
      const s = read();
      const tok = token(s);
      if (!tok) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      try {
        const updates = await tg<Update[]>(tok, "getUpdates", { offset, timeout: 25, allowed_updates: ["message"] }, 35_000);
        lastError = undefined;
        for (const u of updates) {
          offset = u.update_id + 1;
          // One at a time, in order; a failure on one message must not stop the rest.
          await handle(tok, u).catch(() => {});
        }
      } catch (e) {
        const code = (e as { code?: number }).code;
        lastError = code === 401 ? "Telegram no longer accepts this bot token. Connect again." : code === 409 ? "Another app is reading this bot's messages. Use this bot only with oovi." : undefined;
        await new Promise((r) => setTimeout(r, code === 401 ? 30_000 : 5000));
      }
    }
  })();
}
