// Talk to your main bot from Telegram while you're away from the computer.
//
// Setup (Settings > Telegram): create a bot with @BotFather, paste its token,
// then press Start in Telegram through the link oovi shows. That link carries a
// one-time code, so only you can pair. oovi then:
// - forwards your Telegram messages to the main bot's chat and replies with its answer,
// - asks for approvals there (/yes or /no),
// - sends the main bot's reports (e.g. "Studio finished").
// It uses long polling: nothing is opened to the internet, and it runs while oovi is open.
//
// Advanced (Settings > Telegram > Advanced): other Telegram chats, usually Telegram groups,
// can be linked to an oovi group. Messages there go to that group (its leader answers),
// approvals for that work are asked there, and files bots send go there. Only the main chat
// and linked chats are answered; the routing rules live in telegram-links.ts.

import { translateFor, translatorFor } from "./i18n-server";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { onReport, waitingGroupTasks } from "./delegations";
import { plainText } from "./delegations-core";
import { isRunning, startRun, subscribe, whenIdle } from "./runner";
import { dataDir, decryptSecret, encryptSecret } from "./settings";
import { dmId, getChat, listBots, listChats } from "./store";
import { mainBot } from "./team";
import { approvalCommand, canApprove, cleanLabel, parseChatId, planAnswer, routeUpdate, yesNo, type TgDetected, type TgLink, type TgMessage, type TgUpdate } from "./telegram-links";
import { telegramUploadRequest } from "./telegram-upload";
import type { BotEntry, Chat } from "./types";

type Stored = {
  token?: string;
  botUsername?: string;
  botName?: string;
  chatId?: number;
  userName?: string;
  pairCode?: string;
  /** Advanced: other Telegram chats linked to oovi groups. */
  links?: TgLink[];
  /** Advanced: chats that wrote to the bot but aren't linked yet (newest first). */
  detected?: TgDetected[];
  /** Chats that already got the one "not linked yet" notice. */
  noticed?: number[];
};
/** Chat IDs go to the UI as strings (exact, and easy to show and type). The bot token never does. */
export type TelegramLinkInfo = { chatId: string; groupId: string; groupName?: string; label: string };
export type TelegramDetectedInfo = { chatId: string; title: string; type: string; at: number };
export type TelegramStatus = {
  mainName?: string;
  hasToken: boolean;
  botUsername?: string;
  botName?: string;
  connected: boolean;
  userName?: string;
  pairLink?: string;
  error?: string;
  links: TelegramLinkInfo[];
  detected: TelegramDetectedInfo[];
  /** Only with status({ groups: true }): the oovi groups a chat can be linked to. */
  groups?: { id: string; name: string }[];
};

// OOVI_TELEGRAM_API: tests point this at a local stand-in; never set in the app.
const API = process.env.OOVI_TELEGRAM_API || "https://api.telegram.org";
const file = () => path.join(dataDir(), "telegram.json");
const MAX_DETECTED = 10;
const MAX_NOTICED = 200;
const MAX_LINKS = 50;

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

/** Read, change and write in one synchronous step (no await in between, so nothing else interleaves). */
function change(fn: (s: Stored) => void): Stored {
  const s = read();
  fn(s);
  write(s);
  return s;
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

const groupChats = () => listChats().filter((c) => c.kind === "group");

export function status(opts: { groups?: boolean } = {}): TelegramStatus {
  const s = read();
  const groups = s.token && (opts.groups || s.links?.length) ? groupChats().map((c) => ({ id: c.id, name: c.name })) : [];
  return {
    mainName: mainBot()?.name,
    hasToken: !!s.token,
    botUsername: s.botUsername,
    botName: s.botName,
    connected: !!s.chatId,
    userName: s.userName,
    pairLink: s.token && !s.chatId && s.botUsername && s.pairCode ? `https://t.me/${s.botUsername}?start=${s.pairCode}` : undefined,
    error: lastError,
    links: s.token ? (s.links ?? []).map((l) => ({ chatId: String(l.chatId), groupId: l.groupId, groupName: groups.find((g) => g.id === l.groupId)?.name, label: l.label })) : [],
    detected: s.token ? (s.detected ?? []).map((d) => ({ chatId: String(d.chatId), title: d.title, type: d.type, at: d.at })) : [],
    ...(opts.groups ? { groups } : {}),
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

/** Is a Telegram chat paired (so oovi can send the user messages)? */
export function telegramConnected(): boolean {
  const s = read();
  return !!s.chatId && !!token(s);
}

/** Send a text to the user's paired main chat (e.g. a routine's result). Resolves false when not connected or not sent. */
export async function sendToMainChat(text: string): Promise<boolean> {
  const s = read();
  const tok = token(s);
  if (!tok || !s.chatId) return false;
  try {
    await say(tok, s.chatId, text);
    return true;
  } catch {
    return false;
  }
}

// ---------- advanced: chats linked to groups ----------

/** Link a Telegram chat to an oovi group, or change a link (previousChatId: the link being edited). */
export function saveLink(input: { chatId?: unknown; groupId?: unknown; label?: unknown; previousChatId?: unknown }): TelegramStatus {
  const chatId = parseChatId(input.chatId);
  if (chatId === null) throw new Error("That isn't a Telegram chat ID. It's a whole number, like -1001234567890 for a group.");
  const prev = input.previousChatId === undefined || input.previousChatId === null || input.previousChatId === "" ? null : parseChatId(input.previousChatId);
  const groupId = typeof input.groupId === "string" ? input.groupId : "";
  const group = groupChats().find((c) => c.id === groupId);
  if (!group) throw new Error("Pick one of your groups.");
  change((s) => {
    if (!s.token) throw new Error("Connect your Telegram bot first.");
    if (chatId === s.chatId) throw new Error("That's your main chat. It already talks to your main bot.");
    const links = s.links ?? [];
    if (links.some((l) => l.chatId === chatId && l.chatId !== prev)) throw new Error("That chat is already linked.");
    const label = cleanLabel(input.label) || s.detected?.find((d) => d.chatId === chatId)?.title || group.name;
    const link: TgLink = { chatId, groupId, label, at: Date.now() };
    const i = prev === null ? -1 : links.findIndex((l) => l.chatId === prev);
    if (i >= 0) links[i] = link;
    else {
      if (links.length >= MAX_LINKS) throw new Error(`You can link up to ${MAX_LINKS} chats.`);
      links.push(link);
    }
    s.links = links;
    s.detected = (s.detected ?? []).filter((d) => d.chatId !== chatId);
  });
  return status({ groups: true });
}

/** Unlink a chat. Takes effect on its next message (every message checks the saved links). */
export function removeLink(rawChatId: unknown): TelegramStatus {
  const chatId = parseChatId(rawChatId);
  if (chatId === null) throw new Error("That isn't a Telegram chat ID.");
  change((s) => {
    s.links = (s.links ?? []).filter((l) => l.chatId !== chatId);
  });
  return status({ groups: true });
}

/** Forget a chat in the "waiting to be linked" list. */
export function dismissDetected(rawChatId: unknown): TelegramStatus {
  const chatId = parseChatId(rawChatId);
  if (chatId === null) throw new Error("That isn't a Telegram chat ID.");
  change((s) => {
    s.detected = (s.detected ?? []).filter((d) => d.chatId !== chatId);
  });
  return status({ groups: true });
}

/** May oovi still write to this Telegram chat? (The main chat, or a chat that is linked right now.) */
function allowedChat(s: Stored, chatId: number): boolean {
  return chatId === s.chatId || !!s.links?.some((l) => l.chatId === chatId);
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

// ---------- outbox: answers and reports that must arrive ----------
//
// A bot's answer or a group's result is written here first, then sent. A send that fails
// (offline, the computer waking up, Telegram busy) is tried again with growing waits, also
// after a restart, for up to two days. Telegram refusing it for good (chat gone, bot blocked)
// drops it. Each part of a long message is its own item, so a retry never repeats a part
// that already arrived, and a chat's messages always go out in order.

type OutItem = { id: string; chatId: number; text: string; attempts: number; nextAt: number; at: number };
const outboxFile = () => path.join(dataDir(), "telegram-outbox.json");
const OUTBOX_MAX_AGE = 48 * 60 * 60 * 1000;
const OUTBOX_MAX = 300;
const BACKOFF = [10_000, 30_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000];

function readOutbox(): OutItem[] {
  try {
    const list = JSON.parse(fs.readFileSync(outboxFile(), "utf8")) as unknown;
    return Array.isArray(list) ? (list as OutItem[]).filter((x) => x && typeof x.chatId === "number" && typeof x.text === "string") : [];
  } catch {
    return [];
  }
}

function writeOutbox(list: OutItem[]) {
  const f = outboxFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(-OUTBOX_MAX)), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

/** Send a message that must arrive: saved first, then sent, and retried until it does. */
function deliver(chatId: number, text: string): void {
  const now = Date.now();
  const items = chunks(text).map((part): OutItem => ({ id: crypto.randomUUID(), chatId, text: part, attempts: 0, nextAt: now, at: now }));
  writeOutbox([...readOutbox(), ...items]);
  void flushOutbox();
}

let flushing = false;

/** Send what's due, oldest first. One flush at a time (one already going picks up new items). */
async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  {
    try {
      const tok = token(read());
      if (!tok) return;
      // Several rounds: items queued while a round was sending go out in the same flush.
      for (let round = 0; round < 5; round++) {
        const now = Date.now();
        const queued = readOutbox().filter((x) => now - x.at < OUTBOX_MAX_AGE);
        if (!queued.some((x) => x.nextAt <= now)) break;
        const blocked = new Set<number>(); // a chat whose earlier message isn't sent yet: keep its order
        const sent = new Set<string>();
        const dropped = new Set<string>();
        const failed = new Map<string, number>();
        for (const item of queued) {
          if (blocked.has(item.chatId)) continue;
          if (item.nextAt > now) {
            blocked.add(item.chatId); // waiting to retry: nothing newer for that chat may overtake it
            continue;
          }
          try {
            await tg(tok, "sendMessage", { chat_id: item.chatId, text: item.text, disable_web_page_preview: true });
            sent.add(item.id);
          } catch (e) {
            const code = (e as { code?: number }).code ?? 0;
            // 400: the chat or message is wrong for good; 403: the user blocked the bot or left.
            if (code === 400 || code === 403) {
              console.error(`[telegram] dropped a message to ${item.chatId}: ${(e as Error).message}`);
              dropped.add(item.id);
            } else {
              blocked.add(item.chatId);
              failed.set(item.id, Date.now() + BACKOFF[Math.min(item.attempts, BACKOFF.length - 1)]!);
            }
          }
        }
        // Re-read before writing: deliver() may have added items while this round was sending.
        const latest = readOutbox();
        writeOutbox(
          latest
            .filter((x) => !sent.has(x.id) && !dropped.has(x.id) && Date.now() - x.at < OUTBOX_MAX_AGE)
            .map((x) => (failed.has(x.id) ? { ...x, attempts: x.attempts + 1, nextAt: failed.get(x.id)! } : x)),
        );
        if (failed.size || (!sent.size && !dropped.size)) break;
      }
    } catch (e) {
      console.error("[telegram] outbox:", (e as Error).message);
    } finally {
      flushing = false;
    }
  }
}

/**
 * Upload a file to a Telegram chat (photos inline, everything else as a document): the chat the
 * user is writing from (toChatId), else the paired main chat. Returns an error message, or null when sent.
 */
export async function sendFileToTelegram(file: { name: string; data: Buffer }, caption?: string, toChatId?: number): Promise<string | null> {
  const s = read();
  const tok = token(s);
  const target = toChatId ?? s.chatId;
  if (!tok || target === undefined) return "Telegram isn't connected (Settings > Telegram).";
  if (!allowedChat(s, target)) return "That Telegram chat isn't linked to oovi any more.";
  const req = telegramUploadRequest(tok, target, file, caption);
  if ("error" in req) return req.error;
  try {
    const r = await fetch(req.url, { ...req.init, body: new Uint8Array(req.init.body), signal: AbortSignal.timeout(180_000) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return j.ok ? null : `Telegram didn't accept the file: ${j.description || `error ${r.status}`}`;
  } catch (e) {
    return `Couldn't reach Telegram: ${(e as Error).message}`;
  }
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

/** Where a Telegram message goes: the main bot's chat, or an oovi group linked to this Telegram chat. */
type Target = { tgChatId: number; ooviChatId: string; name: string; group: boolean; tgGroup: boolean; ownerName?: string };

/** Run the main bot (or a linked group) on a message (or approval) and send back what it said. */
async function relay(tok: string, target: Target, input: { text?: string; decisions?: Record<string, boolean>; alwaysEdit?: boolean; alwaysFolders?: boolean; planDecision?: { approve: boolean; items: string[] } }) {
  const { tgChatId: chatId, ooviChatId: id, name } = target;
  if (!target.group) getChat(id); // create the main bot's chat if needed
  // oovi's own words here follow the user's language: this message's, else their latest one (a bare /yes says nothing).
  const tr = translatorFor(input.text?.trim() && !input.text.trim().startsWith("/") ? input.text : lastUserText(getChat(id)));
  if (isRunning(id)) {
    // Busy with something started elsewhere (the app, a routine): this message goes next.
    await say(tok, chatId, tr("tg.busyNext", { name: target.group ? `"${name}"` : name }));
    const free = await whenIdle(id, BUSY_WAIT_MS);
    if (!free || isRunning(id)) return deliver(chatId, tr("tg.busyLong", { name: target.group ? `"${name}"` : name }));
  }
  // What each message looked like before this run: a bot that was waiting for an OK continues its OWN message
  // after /yes, so "new" isn't enough; a message that changed counts too (otherwise: "didn't reply").
  const sig = (e: { kind: string; text?: string; status?: string; steps?: unknown[] }) => `${e.kind === "bot" ? e.status : ""}|${e.text?.length ?? 0}|${e.steps?.length ?? 0}`;
  const before = new Map((getChat(id)?.entries ?? []).map((e) => [e.id, sig(e)]));
  const typing = setInterval(() => void tg(tok, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}), 4500);
  void tg(tok, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  try {
    if (!startRun(id, { ...input, channel: "telegram", telegramChatId: chatId })) return say(tok, chatId, tr("tg.busy", { name: target.group ? `"${name}"` : name }));
    await waitDone(id);
  } finally {
    clearInterval(typing);
  }
  // Unlinked while the group was working: say nothing more there.
  if (!allowedChat(read(), chatId)) return;
  const chat = getChat(id);
  if (!chat) return;
  const bots = target.group ? listBots() : [];
  const who = (botId: string) => (target.group ? (bots.find((b) => b.id === botId)?.name ?? "A bot") : name);
  const fresh = chat.entries.filter((e): e is BotEntry => e.kind === "bot" && (before.get(e.id) !== sig(e) || e.id === chat.pending?.approval?.entryId));
  const last = [...fresh].reverse().find((e) => e.text || e.error);
  if (chat.pending?.approval) {
    const a = chat.pending.approval;
    const items = a.items.map((x, i) => `${i + 1}. ${x.summary}${x.detail ? `\n${x.detail.slice(0, 600)}` : ""}`).join("\n");
    const folders = [...new Set(a.items.map((x) => x.folder).filter((f): f is string => !!f))];
    const always = folders.length
      ? `\n${tr("tg.alwaysFolders", { folders: folders.length === 1 ? folders[0]! : tr("tg.theseFolders") })}`
      : a.items.some((x) => x.always)
        ? `\n${tr("tg.alwaysEdit")}`
        : "";
    const onlyOwner = target.tgGroup ? `\n${tr("tg.onlyOwner", { name: target.ownerName ?? tr("tg.owner") })}` : "";
    const head = target.group ? tr("tg.needsOkIn", { bot: who(a.botId), group: name }) : tr("tg.needsOk", { bot: who(a.botId) });
    return deliver(chatId, `${head}\n${items}\n\n${tr("tg.okHow")}${always}${onlyOwner}`);
  }
  if (chat.pending?.planReview) {
    const review = chat.pending.planReview;
    const e = chat.entries.find((x): x is BotEntry => x.kind === "bot" && x.id === review.entryId);
    const steps = (e?.plan ?? []).map((p, i) => `${i + 1}. ${p.text}`).join("\n");
    const onlyOwner = target.tgGroup ? `\n${tr("tg.onlyOwner", { name: target.ownerName ?? tr("tg.owner") })}` : "";
    const head = target.group ? tr("tg.planIn", { bot: who(review.botId), group: name }) : tr("tg.plan", { bot: who(review.botId) });
    return deliver(chatId, `${head}${e?.text ? `\n${e.text}` : ""}\n${steps}\n\n${tr("tg.planHow")}${onlyOwner}`);
  }
  if (!target.group) {
    if (last?.status === "error") return deliver(chatId, tr("grp.problem", { bot: name, error: last.error ?? "unknown error" }));
    if (last?.text) return deliver(chatId, plainText(last.text));
    return deliver(chatId, tr("tg.noReply", { name }));
  }
  // The final message in full, and what the others said in short: a link or a figure is often there.
  const others = fresh.filter((e) => e !== last && e.status === "done" && e.text.trim()).slice(-4);
  const also = others.length
    ? `\n\n${tr(last?.status === "error" ? "grp.before" : "grp.also")}\n${others.map((e) => `${who(e.botId)}: ${clipText(plainText(e.text), 500)}`).join("\n\n")}`
    : "";
  if (last?.status === "error") return deliver(chatId, `${tr("grp.problem", { bot: who(last.botId), error: last.error ?? "unknown error" })}${also}`);
  if (last?.text) return deliver(chatId, `${who(last.botId)}:\n${plainText(last.text)}${also}`);
  return deliver(chatId, tr("grp.noReply", { group: name }));
}

/** The user's latest message in a chat (what oovi's own words should match). */
function lastUserText(chat: Chat | null | undefined): string | undefined {
  return chat ? [...chat.entries].reverse().find((e) => e.kind === "user" && e.text.trim() && !e.text.trim().startsWith("/"))?.text : undefined;
}

const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A run started elsewhere (the app, a routine) gets this long to finish before a Telegram message gives up. */
const BUSY_WAIT_MS = 30 * 60 * 1000;

/** Whether what the chat waits for was shown in this Telegram chat (then a plain "yes"/"no" can answer it). */
const shownHere = (chat: Chat | null | undefined, tgChatId: number) => chat?.pending?.channel === "telegram" && chat.pending.telegramChatId === tgChatId;

/** "/yes" or "/no" (or, words: a plain yes/no word) while a proposed plan waits: run it as proposed, or cancel it. Other text asks for changes. */
function planCommand(text: string, chat: Chat | null | undefined, words = false): { approve: boolean; items: string[] } | null {
  const review = chat?.pending?.planReview;
  if (!chat || !review) return null;
  const approve = planAnswer(text, words);
  if (approve === null) return null;
  const e = chat.entries.find((x) => x.id === review.entryId);
  return { approve, items: e?.kind === "bot" ? (e.plan ?? []).map((p) => p.text) : [] };
}

/**
 * Nothing waits on the main bot itself, but a group it gave a task asked the user for an OK
 * or proposed a plan (and the user was told here): "/yes" or "/no" answers that group. The
 * group goes on in the background; its result comes back here through the main bot's reports.
 */
async function answerGroup(tok: string, chatId: number, text: string): Promise<boolean> {
  const all = waitingGroupTasks();
  if (!all.length) return false;
  let waiting = all[0]!;
  let answer = text;
  if (all.length > 1) {
    // Several groups wait: a bare /yes must not guess which one. "/yes Studio" names it.
    const named = text.match(/^\/(yes|no)\s+(?!always\b)(.+)$/i);
    const q = named?.[2]?.trim().toLowerCase();
    const hit = q ? all.find((w) => w.group.name.toLowerCase() === q) ?? all.find((w) => w.group.name.toLowerCase().includes(q)) : undefined;
    if (!hit) {
      if (!/^\/(yes|no)\b/i.test(text) && yesNo(text) === null) return false; // a normal message
      await say(tok, chatId, `${all.length} groups are waiting for your answer: ${all.map((w) => `"${w.group.name}"`).join(", ")}. Reply /yes or /no followed by the group's name, e.g. /yes ${all[0]!.group.name}`);
      return true;
    }
    waiting = hit;
    answer = `/${named![1]}`;
  }
  const { group } = waiting;
  // A plain "yes"/"no" only for the one request the user was asked about in this chat.
  const words = all.length === 1 && waiting.delegation.origin?.telegramChatId === chatId;
  let input: { decisions?: Record<string, boolean>; alwaysEdit?: boolean; alwaysFolders?: boolean; planDecision?: { approve: boolean; items: string[] } } | null = null;
  let approved = false;
  if (waiting.kind === "approval") {
    const ac = approvalCommand(answer, group.pending?.approval, words);
    if (ac.kind === "decide") {
      input = ac.input;
      approved = Object.values(ac.input.decisions).some(Boolean);
    }
  } else {
    const plan = planCommand(answer, group, words);
    if (plan) {
      input = { planDecision: plan };
      approved = plan.approve;
    }
  }
  if (!input) return false;
  if (!startRun(group.id, { ...input, channel: "telegram", telegramChatId: chatId })) {
    await say(tok, chatId, `"${group.name}" is busy right now. Try again in a moment.`);
    return true;
  }
  const what = waiting.kind === "plan" ? (approved ? "runs the plan" : null) : approved ? "goes on" : "goes on without it";
  await say(tok, chatId, what ? `OK. "${group.name}" ${what}; I'll send its answer here when it's done.` : `OK, "${group.name}"'s plan is cancelled.`);
  return true;
}

/** Today's behaviour: pairing, then the main chat talks to the main bot. */
async function handleMain(tok: string, s: Stored, m: TgMessage) {
  const text = (m.text ?? "").trim();

  // Pairing: only the person who opened oovi's link (with its one-time code) gets in.
  if (!s.chatId) {
    const code = text.match(/^\/start\s+(\w+)/)?.[1];
    if (code && s.pairCode && code === s.pairCode) {
      change((cur) => {
        cur.chatId = m.chat.id;
        cur.userName = m.from?.first_name || m.from?.username;
        cur.pairCode = undefined;
        cur.detected = (cur.detected ?? []).filter((d) => d.chatId !== m.chat.id);
      });
      const bot = mainBot();
      await say(tok, m.chat.id, `Connected! You're talking to ${bot?.name ?? "your main bot"} in oovi. Ask anything, or ask it to put a group to work. It answers while oovi is open on your computer.`);
    } else {
      await say(tok, m.chat.id, "This is a private oovi bot. To connect, use the link shown in oovi > Settings > Telegram.");
    }
    return;
  }

  if (!text) return say(tok, m.chat.id, "I can read text messages for now.");
  if (/^\/start\b/.test(text)) return say(tok, m.chat.id, "You're connected. Send a message to talk to your main bot.");
  const bot = mainBot();
  if (!bot) return say(tok, m.chat.id, "You have no bots yet. Create one in oovi first.");
  const target: Target = { tgChatId: m.chat.id, ooviChatId: dmId(bot.id), name: bot.name, group: false, tgGroup: false };
  const own = getChat(dmId(bot.id));
  const plan = planCommand(text, own, shownHere(own, m.chat.id));
  if (plan) return relay(tok, target, { planDecision: plan });
  const ac = approvalCommand(text, own?.pending?.approval, shownHere(own, m.chat.id));
  if (ac.kind === "decide") return relay(tok, target, ac.input);
  // Not for the main bot: maybe for a group it gave a task, which is waiting for the user.
  if (!own?.pending?.approval && !own?.pending?.planReview && (await answerGroup(tok, m.chat.id, text))) return;
  if (ac.kind === "nothing-pending") return say(tok, m.chat.id, "Nothing is waiting for your OK right now.");
  return relay(tok, target, { text: text.slice(0, 20_000) });
}

/** A message from a Telegram chat linked to an oovi group (already checked: linked, and addressed to the bot). */
async function handleLinked(tok: string, s: Stored, m: TgMessage, link: TgLink, text: string) {
  const cid = m.chat.id;
  const tgGroup = m.chat.type !== "private";
  const group = getChat(link.groupId);
  if (!group || group.kind !== "group") return say(tok, cid, "This chat is linked to an oovi group that no longer exists. Link it again in oovi > Settings > Telegram > Advanced.");
  if (!text) return tgGroup ? undefined : say(tok, cid, "I can read text messages for now.");
  if (/^\/start\b/i.test(text)) {
    return say(tok, cid, `This chat is linked to the oovi group "${group.name}".${tgGroup ? ` Mention @${s.botUsername ?? "me"} or reply to my messages to talk to it.` : " Send a message to talk to it."}`);
  }
  const target: Target = { tgChatId: cid, ooviChatId: group.id, name: group.name, group: true, tgGroup, ownerName: s.userName };
  // A plain "yes"/"no" counts only from someone who may answer, for a request shown in this chat.
  const words = shownHere(group, cid) && canApprove(m, link, s.chatId);
  const plan = planCommand(text, group, words);
  if (plan) {
    if (!canApprove(m, link, s.chatId)) {
      return say(tok, cid, s.chatId ? `Only ${s.userName ?? "the owner of this oovi"} can answer plans here.` : "Plans here need the owner's own Telegram: pair it first in oovi > Settings > Telegram.");
    }
    return relay(tok, target, { planDecision: plan });
  }
  const ac = approvalCommand(text, group.pending?.approval, words);
  if (ac.kind === "nothing-pending") return say(tok, cid, "Nothing is waiting for an OK right now.");
  if (ac.kind === "decide") {
    if (!canApprove(m, link, s.chatId)) {
      return say(tok, cid, s.chatId ? `Only ${s.userName ?? "the owner of this oovi"} can answer approvals here.` : "Approvals here need the owner's own Telegram: pair it first in oovi > Settings > Telegram.");
    }
    return relay(tok, target, ac.input);
  }
  // In a Telegram group several people can write: tell the bots who it is (the owner needs no label).
  const fromOwner = m.from?.id !== undefined && m.from.id === s.chatId;
  const sender = cleanLabel([m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username, 40);
  const body = tgGroup && !fromOwner && sender ? `[${sender} on Telegram] ${text}` : text;
  return relay(tok, target, { text: body.slice(0, 20_000) });
}

/** A chat nobody linked: list it in Settings, and send at most one short notice, ever. */
async function handleUnknown(tok: string, chatId: number, title: string, type: string) {
  let notice = false;
  change((s) => {
    const others = (s.detected ?? []).filter((d) => d.chatId !== chatId);
    s.detected = [{ chatId, title, type, at: Date.now() }, ...others].slice(0, MAX_DETECTED);
    const noticed = s.noticed ?? [];
    if (!noticed.includes(chatId)) {
      notice = true;
      s.noticed = [...noticed, chatId].slice(-MAX_NOTICED);
    }
  });
  if (notice) await say(tok, chatId, `This chat isn't linked to oovi yet. Its owner can link it in oovi > Settings > Telegram > Advanced (chat ID ${chatId}).`);
}

async function handle(tok: string, u: TgUpdate) {
  const s = read();
  const route = routeUpdate(u, { mainChatId: s.chatId, links: s.links ?? [], botUsername: s.botUsername });
  const m = u.message;
  if (route.kind === "ignore" || !m) return;
  if (route.kind === "migrate") {
    change((cur) => {
      const links = cur.links ?? [];
      if (links.some((l) => l.chatId === route.to) || route.to === cur.chatId) return;
      for (const l of links) if (l.chatId === route.from) l.chatId = route.to;
    });
    return;
  }
  if (route.kind === "unknown") return handleUnknown(tok, route.chatId, route.title, route.type);
  if (route.kind === "linked") return handleLinked(tok, s, m, route.link, route.text);
  return handleMain(tok, s, m);
}

// ---------- long polling ----------

type State = { gen: number; offReport?: () => void; lanes: Map<number, Promise<void>>; outboxTimer?: ReturnType<typeof setInterval> };
const g = globalThis as typeof globalThis & { __ooviTelegram?: State };

/** Start (or restart) listening. Safe to call many times. */
export function startTelegram(): void {
  const state: State = (g.__ooviTelegram ??= { gen: 0, lanes: new Map<number, Promise<void>>() });
  state.lanes ??= new Map(); // a listener started by an older build (hot reload) has no lanes yet
  const gen = ++state.gen;
  state.offReport?.();
  // The main bot's reports (a group's result, a request for the user's OK) must arrive.
  state.offReport = onReport((text) => {
    const s = read();
    if (token(s) && s.chatId) deliver(s.chatId, text);
  });
  // Retry what couldn't be sent (also what was waiting when oovi closed).
  if (state.outboxTimer) clearInterval(state.outboxTimer);
  state.outboxTimer = setInterval(() => void flushOutbox(), 15_000);
  state.outboxTimer.unref?.();
  setTimeout(() => void flushOutbox(), 2_000).unref?.();
  // Each Telegram chat has its own queue: messages in one chat run in order, and a long
  // group job in a linked chat doesn't hold up the main chat.
  const enqueue = (chatId: number, job: () => Promise<void>) => {
    const next: Promise<void> = (state.lanes.get(chatId) ?? Promise.resolve())
      .then(job)
      .catch(() => {}) // a failure on one message must not stop the rest
      .finally(() => {
        if (state.lanes.get(chatId) === next) state.lanes.delete(chatId);
      });
    state.lanes.set(chatId, next);
  };
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
        const updates = await tg<TgUpdate[]>(tok, "getUpdates", { offset, timeout: 25, allowed_updates: ["message"] }, 35_000);
        lastError = undefined;
        for (const u of updates) {
          offset = u.update_id + 1;
          const chatId = u.message?.chat?.id;
          if (typeof chatId === "number") enqueue(chatId, () => handle(tok, u));
        }
      } catch (e) {
        const code = (e as { code?: number }).code;
        lastError = code === 401 ? "Telegram no longer accepts this bot token. Connect again." : code === 409 ? "Another app is reading this bot's messages. Use this bot only with oovi." : undefined;
        await new Promise((r) => setTimeout(r, code === 401 ? 30_000 : 5000));
      }
    }
  })();
}
