// Telegram relay: messages to a user's own Telegram bot come here first (a webhook), and their oovi app
// collects them (GET /api/v1/telegram/updates). So when the computer is off or oovi is closed, the user
// is told at once, in their language, to open oovi; the message is answered when it opens.
// Kept here: the bot's token (encrypted, like other secrets), the chats the app answers, the user's
// language, and each message only until the app has collected it (24 hours at most, encrypted).
// The app still sends its replies itself. The tables are created on first use (and in scripts/migrate.mjs).
//
// Several computers: the connection (token, paired chat, linked groups) is kept here, so every computer the
// user signs in on connects to the same bot by itself. One computer answers at a time: the one answering
// keeps the messages while it is on; when it goes quiet for OFFLINE_AFTER_MS, the next one that asks takes
// over. Disconnecting on any computer disconnects them all (a computer connected before that is told so).
import crypto from "node:crypto";
import { pool } from "./db";
import { sealSecret, unsealSecret, type Sealed } from "./ai-config";
import { siteUrl } from "./site";

const TG = process.env.OOVI_TELEGRAM_API || "https://api.telegram.org";
/** The app collects every ~20 s; quiet for longer than this, it is considered closed. */
export const OFFLINE_AFTER_MS = 75_000;
/** One "open oovi" notice per chat per this long, however many messages arrive. */
const NOTICE_EVERY_MS = 10 * 60_000;
export const TOKEN_RE = /^\d{5,15}:[\w-]{30,60}$/;

export const RELAY_DDL = `
  CREATE TABLE IF NOT EXISTS telegram_relays (
    user_id      TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    hook_id      TEXT NOT NULL UNIQUE,
    secret       TEXT NOT NULL,
    token        JSONB NULL,
    config       JSONB NULL,
    connected_at BIGINT NOT NULL DEFAULT 0,
    disconnected_at BIGINT NULL,
    active_device TEXT NULL,
    active_seen_at TIMESTAMPTZ NULL,
    chats        BIGINT[] NOT NULL DEFAULT '{}',
    language     TEXT NOT NULL DEFAULT 'en',
    notices      JSONB NOT NULL DEFAULT '{}',
    last_poll_at TIMESTAMPTZ NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS telegram_inbox (
    id         BIGSERIAL PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    data       JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS telegram_inbox_user_idx ON telegram_inbox (user_id, id);
`;

const g = globalThis as typeof globalThis & { __ooviRelayTables?: boolean };
async function ensureTables() {
  if (g.__ooviRelayTables) return;
  await pool.query(RELAY_DDL);
  g.__ooviRelayTables = true;
}

async function tg<T>(token: string, method: string, body: unknown): Promise<T> {
  const r = await fetch(`${TG}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!j?.ok) throw new Error(j?.description || `Telegram error ${r.status}`);
  return j.result as T;
}

export class RelayGone extends Error {}

/**
 * Turns the relay on for this user's bot (or updates its chats, language and connection details).
 * connectedAt: when the user connected Telegram on that computer; older than a disconnect = RelayGone.
 */
export async function registerRelay(userId: string, token: string, chats: number[], language: string, config: Record<string, unknown>, connectedAt: number): Promise<void> {
  await ensureTables();
  const cur = await pool.query("SELECT hook_id, secret, disconnected_at FROM telegram_relays WHERE user_id = $1", [userId]);
  const gone = Number(cur.rows[0]?.disconnected_at ?? 0);
  if (gone && connectedAt <= gone) throw new RelayGone("Telegram was disconnected on another computer.");
  await tg(token, "getMe", {});
  const hookId = (cur.rows[0]?.hook_id as string) ?? crypto.randomBytes(16).toString("hex");
  const secret = (cur.rows[0]?.secret as string) ?? crypto.randomBytes(24).toString("hex");
  await pool.query(
    `INSERT INTO telegram_relays (user_id, hook_id, secret, token, chats, language, config, connected_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, chats = EXCLUDED.chats, language = EXCLUDED.language, config = EXCLUDED.config,
       connected_at = GREATEST(telegram_relays.connected_at, EXCLUDED.connected_at), disconnected_at = NULL, updated_at = now()`,
    [userId, hookId, secret, sealSecret(token), chats, language, sealSecret(JSON.stringify(config)), Math.floor(connectedAt)],
  );
  await tg(token, "setWebhook", { url: `${siteUrl()}/api/v1/telegram/hook/${hookId}`, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: false });
}

/**
 * Turns it off for all the user's computers: Telegram stops sending here, the token, connection and waiting
 * messages are deleted; only the time of the disconnect is kept, so other computers disconnect too.
 */
export async function removeRelay(userId: string): Promise<void> {
  await ensureTables();
  const { rows } = await pool.query("SELECT token FROM telegram_relays WHERE user_id = $1", [userId]);
  if (rows[0]?.token) await tg(unsealSecret(rows[0].token as Sealed), "deleteWebhook", { drop_pending_updates: false }).catch(() => {});
  await pool.query("UPDATE telegram_relays SET token = NULL, config = NULL, chats = '{}', notices = '{}', active_device = NULL, disconnected_at = $2, updated_at = now() WHERE user_id = $1", [userId, Date.now()]);
  await pool.query("DELETE FROM telegram_inbox WHERE user_id = $1", [userId]);
}

/**
 * A message to the user's own paired Telegram chat, sent from here (the cloud server ran a routine while the computer
 * was off). false: no Telegram connected, or Telegram refused it.
 */
export async function sendToOwner(userId: string, text: string): Promise<boolean> {
  const c = await getConnection(userId);
  if (!c || !("token" in c)) return false;
  const chatId = typeof c.config.chatId === "number" ? c.config.chatId : null;
  if (chatId === null) return false;
  const parts: string[] = [];
  for (let t = text; t.length; t = t.slice(4000)) parts.push(t.slice(0, 4000));
  try {
    for (const part of parts.slice(0, 5)) await tg(c.token, "sendMessage", { chat_id: chatId, text: part, disable_web_page_preview: true });
    return true;
  } catch {
    return false;
  }
}

/** The account's Telegram connection, for a computer that hasn't got it yet (or "gone" after a disconnect). */
export async function getConnection(userId: string): Promise<{ token: string; config: Record<string, unknown>; connectedAt: number } | { disconnectedAt: number } | null> {
  await ensureTables();
  const { rows } = await pool.query("SELECT token, config, connected_at, disconnected_at FROM telegram_relays WHERE user_id = $1", [userId]);
  const r = rows[0];
  if (!r) return null;
  if (!r.token) return r.disconnected_at ? { disconnectedAt: Number(r.disconnected_at) } : null;
  return { token: unsealSecret(r.token as Sealed), config: r.config ? (JSON.parse(unsealSecret(r.config as Sealed)) as Record<string, unknown>) : {}, connectedAt: Number(r.connected_at) };
}

/**
 * The app collects what came after `after` (and confirms everything up to it, which is then deleted).
 * Waits up to waitMs for something new, checking every 2 s.
 */
export async function collect(userId: string, device: string, after: number, waitMs: number): Promise<{ id: number; update: unknown }[] | null> {
  await ensureTables();
  const r = await pool.query("UPDATE telegram_relays SET last_poll_at = now() WHERE user_id = $1 AND token IS NOT NULL RETURNING user_id", [userId]);
  if (!r.rowCount) return null;
  // One computer answers at a time: this one, unless another one is answering and still on.
  const mine = await pool.query(
    `UPDATE telegram_relays SET active_device = $2, active_seen_at = now()
      WHERE user_id = $1 AND (active_device IS NULL OR active_device = $2 OR active_seen_at < now() - ($3 || ' milliseconds')::interval)
      RETURNING user_id`,
    [userId, device, String(OFFLINE_AFTER_MS)],
  );
  if (!mine.rowCount) {
    await new Promise((ok) => setTimeout(ok, waitMs));
    return [];
  }
  if (after > 0) await pool.query("DELETE FROM telegram_inbox WHERE user_id = $1 AND id <= $2", [userId, after]);
  const end = Date.now() + waitMs;
  for (;;) {
    const { rows } = await pool.query("SELECT id, data FROM telegram_inbox WHERE user_id = $1 AND id > $2 ORDER BY id LIMIT 50", [userId, after]);
    if (rows.length || Date.now() >= end) {
      if (!rows.length) await pool.query("UPDATE telegram_relays SET last_poll_at = now(), active_seen_at = now() WHERE user_id = $1 AND active_device = $2", [userId, device]);
      return rows.map((x) => ({ id: Number(x.id), update: JSON.parse(unsealSecret(x.data as Sealed)) }));
    }
    await new Promise((ok) => setTimeout(ok, 2000));
  }
}

const NOTICE: Record<string, string> = {
  en: "Your computer is off or oovi is closed, so I can't work on this right now. Open oovi on your computer to continue: I'll answer this message then.",
  fr: "Votre ordinateur est éteint ou oovi est fermé, je ne peux donc pas m'en occuper pour le moment. Ouvrez oovi sur votre ordinateur pour continuer : je répondrai alors à ce message.",
  ar: "حاسوبك مطفأ أو oovi مغلق، لذلك لا أستطيع العمل على هذا الآن. افتح oovi على حاسوبك للمتابعة، وسأرد على هذه الرسالة حينها.",
  de: "Dein Computer ist aus oder oovi ist geschlossen, deshalb kann ich gerade nicht daran arbeiten. Öffne oovi auf deinem Computer, um weiterzumachen: Dann beantworte ich diese Nachricht.",
  es: "Tu ordenador está apagado u oovi está cerrado, así que ahora no puedo trabajar en esto. Abre oovi en tu ordenador para continuar: entonces responderé a este mensaje.",
  tr: "Bilgisayarın kapalı ya da oovi kapalı, bu yüzden şu anda bunun üzerinde çalışamıyorum. Devam etmek için bilgisayarında oovi'yi aç: o zaman bu mesajı yanıtlayacağım.",
};

/** The notice in the language of the message (Arabic script) or else the user's language. */
export function noticeFor(text: string, language: string): string {
  if (/[؀-ۿ]/.test(text)) return NOTICE.ar!;
  return NOTICE[language.slice(0, 2)] ?? NOTICE.en!;
}

type TgUpdate = { update_id?: number; message?: { chat?: { id?: number }; text?: string; caption?: string } };

/** A message from Telegram. False when the hook or its secret is wrong (nothing is stored). */
export async function receive(hookId: string, secret: string | null, update: TgUpdate): Promise<boolean> {
  await ensureTables();
  const { rows } = await pool.query("SELECT user_id, secret, token, chats, language, notices, last_poll_at FROM telegram_relays WHERE hook_id = $1", [hookId]);
  const relay = rows[0];
  if (relay && !relay.token) return true; // disconnected: nothing is kept
  const a = Buffer.from(String(secret ?? ""));
  const b = Buffer.from(String(relay?.secret ?? "-"));
  if (!relay || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const userId = String(relay.user_id);
  await pool.query("INSERT INTO telegram_inbox (user_id, data) VALUES ($1, $2)", [userId, sealSecret(JSON.stringify(update))]);
  // Nothing waits here for more than a day (Telegram itself keeps messages 24 hours).
  await pool.query("DELETE FROM telegram_inbox WHERE created_at < now() - interval '24 hours'");

  const chatId = update.message?.chat?.id;
  const offline = !relay.last_poll_at || Date.now() - new Date(relay.last_poll_at as string).getTime() > OFFLINE_AFTER_MS;
  const allowed = typeof chatId === "number" && (relay.chats as string[]).map(Number).includes(chatId);
  if (offline && allowed) {
    const notices = (relay.notices ?? {}) as Record<string, number>;
    const last = notices[String(chatId)] ?? 0;
    if (Date.now() - last > NOTICE_EVERY_MS) {
      notices[String(chatId)] = Date.now();
      await pool.query("UPDATE telegram_relays SET notices = $2 WHERE user_id = $1", [userId, notices]);
      const text = update.message?.text ?? update.message?.caption ?? "";
      await tg(unsealSecret(relay.token as Sealed), "sendMessage", { chat_id: chatId, text: noticeFor(text, String(relay.language)) }).catch(() => {});
    }
  }
  return true;
}
