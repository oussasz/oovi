// Pure helpers of the phone app (no browser, no React): tested in tests/unit/mobile-core.test.mts.
// Only type imports here, so the unit tests can load this file on its own.
import type {
  ApprovalItem,
  BotEntry,
  Chat,
  CloudDevice,
  CloudStatus,
  Entry,
  JobInfo,
  Msg,
  PhoneSetup,
  SetupBot,
  SetupConnector,
  SetupGroup,
  ToolCall,
  UserEntry,
} from "./types";

export type Lang = "en" | "fr" | "ar";

// ---------- text ----------

/** For search: lower case, no accents, no Arabic vowel marks or tatweel, one form of alef, yeh and teh marbuta. */
export function foldText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query is somewhere in one of the texts. */
export function matchesQuery(query: string, texts: string[]): boolean {
  const words = foldText(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = foldText(texts.join(" \n "));
  return words.every((w) => hay.includes(w));
}

/** A message as one line for the list: Markdown marks and links removed, spaces folded, cut at `max`. */
export function plainPreview(text: string, max = 140): string {
  const t = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ")
    .replace(/[*_~`|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "rtl" when the text starts (first strong letter) in Arabic or Hebrew script. */
export function textDir(text: string): "rtl" | "ltr" {
  const m = /[A-Za-zÀ-ɏ֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.exec(text);
  return m && /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(m[0]) ? "rtl" : "ltr";
}

/** The phone's language from the browser's list (Arabic, French, else English). */
export function pickLang(prefs: readonly string[] | undefined, saved?: string | null): Lang {
  if (saved === "en" || saved === "fr" || saved === "ar") return saved;
  for (const p of prefs ?? []) {
    const l = p.toLowerCase().slice(0, 2);
    if (l === "ar" || l === "fr" || l === "en") return l;
  }
  return "en";
}

// ---------- time ----------

const DAY = 86_400_000;
const startOfDay = (t: number, tzOffsetMin: number) => {
  const local = t - tzOffsetMin * 60_000;
  return local - (((local % DAY) + DAY) % DAY) + tzOffsetMin * 60_000;
};

/**
 * iOS list style: today → time, yesterday → "Yesterday", this week → weekday, older → short date.
 * tzOffsetMin is Date#getTimezoneOffset() (minutes, positive west of UTC), passed in so tests are stable.
 */
export function listTime(at: number, now: number, lang: Lang, tzOffsetMin = 0, timeZone = "UTC"): string {
  const locale = lang === "ar" ? "ar-DZ" : lang === "fr" ? "fr-FR" : "en-US";
  const today = startOfDay(now, tzOffsetMin);
  const day = startOfDay(at, tzOffsetMin);
  const diff = Math.round((today - day) / DAY);
  const d = new Date(at);
  if (diff <= 0) return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone, numberingSystem: "latn" });
  if (diff === 1) return lang === "ar" ? "أمس" : lang === "fr" ? "Hier" : "Yesterday";
  if (diff < 7) return d.toLocaleDateString(locale, { weekday: "long", timeZone, numberingSystem: "latn" });
  return d.toLocaleDateString(locale, { day: "numeric", month: "numeric", year: "2-digit", timeZone, numberingSystem: "latn" });
}

/** "now", "5 min", "3 h", "2 d" for "last seen". */
export function agoShort(at: number, now: number, lang: Lang): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  const w = {
    en: { now: "just now", m: "min ago", h: "h ago", d: "d ago" },
    fr: { now: "à l’instant", m: "min", h: "h", d: "j" },
    ar: { now: "الآن", m: "د", h: "س", d: "ي" },
  }[lang];
  if (s < 60) return w.now;
  const pre = lang === "fr" ? "il y a " : lang === "ar" ? "منذ " : "";
  if (s < 3600) return `${pre}${Math.floor(s / 60)} ${w.m}`;
  if (s < 86400) return `${pre}${Math.floor(s / 3600)} ${w.h}`;
  return `${pre}${Math.floor(s / 86400)} ${w.d}`;
}

/** 1536 → "1.5 KB", in the given language's decimal mark. */
export function bytesLabel(n: number, lang: Lang): string {
  const units = lang === "fr" ? ["o", "Ko", "Mo", "Go"] : lang === "ar" ? ["بايت", "ك.ب", "م.ب", "غ.ب"] : ["B", "KB", "MB", "GB"];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const num = i === 0 ? String(Math.round(v)) : v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  return `${lang === "fr" ? num.replace(".", ",") : num} ${units[i]}`;
}

// ---------- setup (bots, groups, connectors) ----------

/**
 * The phone's view of GET /api/v1/setup items: bots (name, role, face), groups, the main bot, and connectors with
 * their name and on/off only. Commands, addresses, key names and instructions are dropped here and never stored.
 */
export function phoneSetup(items: Record<string, unknown> | null | undefined): PhoneSetup {
  const bots: SetupBot[] = [];
  const groups: SetupGroup[] = [];
  const connectors: SetupConnector[] = [];
  let mainId: string | null = null;
  for (const [k, raw] of Object.entries(items ?? {})) {
    const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (k.startsWith("bot:")) {
      if (typeof v.name !== "string" || !v.name) continue;
      bots.push({
        id: k.slice(4),
        name: v.name.slice(0, 60),
        role: typeof v.role === "string" ? v.role.slice(0, 120) : "",
        face: v.face && typeof v.face === "object" ? (v.face as Record<string, unknown>) : {},
        ...(v.hidden === true ? { hidden: true } : {}),
        ...(typeof v.createdAt === "number" ? { createdAt: v.createdAt } : {}),
        ...(v.local === true ? { local: true } : {}),
      });
    } else if (k.startsWith("group:")) {
      const memberIds = Array.isArray(v.memberIds) ? v.memberIds.filter((x): x is string => typeof x === "string") : [];
      if (typeof v.name !== "string") continue;
      groups.push({ id: k.slice(6), name: v.name.slice(0, 60), memberIds, ...(typeof v.leadId === "string" ? { leadId: v.leadId } : {}) });
    } else if (k.startsWith("mcp:")) {
      if (typeof v.name !== "string" || !v.name) continue;
      connectors.push({ id: k.slice(4), name: v.name.slice(0, 80), enabled: v.enabled !== false, kind: v.transport === "stdio" ? "local" : "remote" });
    } else if (k === "main" && typeof raw === "string") {
      mainId = raw;
    }
  }
  bots.sort((a, b) => (a.id === mainId ? -1 : b.id === mainId ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0)));
  connectors.sort((a, b) => a.name.localeCompare(b.name));
  return { bots, groups, connectors, mainId };
}

/** The direct chat with a bot has this id on the computer (lib/store.ts dmId). */
export const dmId = (botId: string) => `dm-${botId}`;

// ---------- chats ----------

/**
 * A chat as the phone keeps it on the device: tool results and old steps dropped, only the newest entries.
 * The running reply keeps its last step (the live status reads it).
 */
export function slimChat(chat: Chat, maxEntries = 120): Chat {
  const entries = chat.entries.slice(-maxEntries).map((e): Entry => {
    if (e.kind !== "bot") return e;
    const { steps, ...rest } = e;
    if (e.status !== "running" || !steps?.length) return rest;
    const last = [...steps].reverse().find((s) => s.role === "assistant");
    const keep: Msg[] = last && last.role === "assistant" ? [{ role: "assistant", text: "", toolCalls: last.toolCalls.slice(-1) }] : [];
    if (steps[steps.length - 1]?.role === "tool") keep.push({ role: "tool", results: [] });
    return { ...rest, steps: keep };
  });
  return { ...chat, entries };
}

export function lastShownEntry(chat: Chat): Entry | undefined {
  for (let i = chat.entries.length - 1; i >= 0; i--) {
    const e = chat.entries[i]!;
    if (e.kind === "user" || e.text.trim() || e.status === "running" || e.status === "error") return e;
  }
  return undefined;
}

export type Names = { botName: (id: string) => string; you: string; working: string; failed: string };

/** "Nova: Here are the 3 hotels…", "You: book it", or the bot at work. */
export function chatPreview(chat: Chat, n: Names): string {
  const e = lastShownEntry(chat);
  if (!e) return "";
  if (e.kind === "user") return `${n.you}: ${plainPreview(e.text) || "📎"}`;
  const who = chat.kind === "group" ? `${n.botName(e.botId)}: ` : "";
  if (e.status === "running" && !e.text.trim()) return `${who}${n.working}`;
  if (e.status === "error" && !e.text.trim()) return `${who}${n.failed}`;
  return `${who}${plainPreview(e.text)}`;
}

export function chatTitle(chat: Pick<Chat, "kind" | "name" | "memberIds">, botName: (id: string) => string | undefined): string {
  if (chat.kind === "direct") return botName(chat.memberIds[0] ?? "") ?? chat.name;
  return chat.name || chat.memberIds.map((m) => botName(m) ?? "").filter(Boolean).join(", ");
}

/** The bot whose reply is being written now, if any. */
export function runningEntry(chat: Chat): BotEntry | undefined {
  for (let i = chat.entries.length - 1; i >= 0; i--) {
    const e = chat.entries[i]!;
    if (e.kind === "bot" && e.status === "running") return e;
  }
  return undefined;
}

export const isRunning = (chat: Chat) => !!runningEntry(chat);
export const isWaiting = (chat: Chat) => !!(chat.pending?.approval || chat.pending?.planReview || chat.pending?.questions);

/** Unread: something the bots wrote after the user last looked at the chat on the phone. */
export function isUnread(chat: Chat, seenAt: number | undefined): boolean {
  if (seenAt === undefined) return false;
  const last = lastShownEntry(chat);
  return !!last && last.kind === "bot" && last.status !== "running" && last.at > seenAt;
}

export type ListRow = { chat: Chat; pinned: boolean; unread: boolean; at: number };

/** Pinned first (in pin order), then newest first. Routine chats and empty chats with no name stay out. */
export function sortChats(chats: Chat[], pins: string[], seen: Record<string, number>): ListRow[] {
  const rows = chats
    .filter((c) => !c.routine && (c.entries.length > 0 || c.kind === "group"))
    .map((c) => ({ chat: c, pinned: pins.includes(c.id) || (c.pinned === true && !pins.includes(`-${c.id}`)), unread: isUnread(c, seen[c.id]), at: lastShownEntry(c)?.at ?? c.updatedAt }));
  return rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return pins.indexOf(a.chat.id) - pins.indexOf(b.chat.id);
    return b.at - a.at;
  });
}

/** Pin list after toggling one chat. A chat pinned on the computer is unpinned on the phone with a "-id" mark. */
export function togglePin(pins: string[], chat: Pick<Chat, "id" | "pinned">): string[] {
  const id = chat.id;
  const on = pins.includes(id) || (chat.pinned === true && !pins.includes(`-${id}`));
  const rest = pins.filter((p) => p !== id && p !== `-${id}`);
  if (on) return chat.pinned ? [...rest, `-${id}`] : rest;
  return chat.pinned ? rest : [...rest, id];
}

// ---------- what the bots are doing ----------

export type Activity = { mood: "thinking" | "reading" | "computer" | "working"; label: string };

const ACT: Record<Lang, Record<string, string>> = {
  en: { think: "Thinking…", write: "typing…", search: "Searching the web", read: "Reading {host}", page: "Reading the page", browse: "Using the browser", table: "Updating the table", notes: "Writing notes", file: "Creating {name}", computer: "Working on your computer", places: "Looking for places", papers: "Looking for publications", team: "Asking the team", tool: "Using {name}", memory: "Remembering", skill: "Using a skill" },
  fr: { think: "Réfléchit…", write: "écrit…", search: "Cherche sur le web", read: "Lit {host}", page: "Lit la page", browse: "Utilise le navigateur", table: "Met à jour le tableau", notes: "Prend des notes", file: "Crée {name}", computer: "Travaille sur votre ordinateur", places: "Cherche des lieux", papers: "Cherche des publications", team: "Demande à l’équipe", tool: "Utilise {name}", memory: "Mémorise", skill: "Utilise une compétence" },
  ar: { think: "يفكّر…", write: "يكتب…", search: "يبحث في الويب", read: "يقرأ {host}", page: "يقرأ الصفحة", browse: "يستخدم المتصفح", table: "يحدّث الجدول", notes: "يكتب ملاحظات", file: "ينشئ {name}", computer: "يعمل على حاسوبك", places: "يبحث عن أماكن", papers: "يبحث عن منشورات", team: "يسأل الفريق", tool: "يستخدم {name}", memory: "يتذكّر", skill: "يستخدم مهارة" },
};

const hostOf = (u: unknown) => {
  try {
    return new URL(String(u)).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** A tool call as a short "doing" line and the face's mood. Inputs are only used for a host or a file name. */
export function activityOf(call: ToolCall | undefined, lang: Lang): Activity {
  const w = ACT[lang];
  const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");
  if (!call) return { mood: "thinking", label: w.think! };
  const n = call.name;
  const i = call.input ?? {};
  if (n === "web_search" || n === "research") return { mood: "reading", label: w.search! };
  if (n === "read_url" || n === "open_url") {
    const host = hostOf(i.url);
    return { mood: "reading", label: host ? fill(w.read!, { host }) : w.page! };
  }
  if (n === "read_page" || n === "scroll" || n === "extract_list" || n === "scrape_list") return { mood: "reading", label: w.page! };
  if (["click", "type", "go_back", "browser_steps", "fill_login"].includes(n)) return { mood: "computer", label: w.browse! };
  if (n.startsWith("desktop_") || n === "open_app" || n === "manage_window") return { mood: "computer", label: w.computer! };
  if (n === "work_table") return { mood: "working", label: w.table! };
  if (n === "work_notes") return { mood: "working", label: w.notes! };
  if (n.startsWith("create_") || n === "work_export") {
    const name = String(i.filename ?? i.name ?? "").split(/[\\/]/).pop()?.slice(0, 40) ?? "";
    return { mood: "working", label: fill(w.file!, { name: name || "…" }) };
  }
  if (n === "find_places") return { mood: "reading", label: w.places! };
  if (n === "find_papers") return { mood: "reading", label: w.papers! };
  if (n === "message_group" || n === "run_helpers" || n === "hand_off") return { mood: "working", label: w.team! };
  if (n === "memory") return { mood: "thinking", label: w.memory! };
  if (n === "use_skill") return { mood: "working", label: w.skill! };
  const pretty = n.replace(/^mcp_/, "").replace(/_/g, " ").slice(0, 40);
  return { mood: "working", label: fill(w.tool!, { name: pretty }) };
}

/** What the running reply is doing now, from its last step. */
export function liveActivity(entry: BotEntry, lang: Lang): Activity {
  const steps = entry.steps ?? [];
  const last = steps[steps.length - 1];
  if (!last) return { mood: "thinking", label: ACT[lang].think! };
  if (last.role === "tool") return { mood: "thinking", label: ACT[lang].think! };
  if (last.role === "assistant" && last.toolCalls.length) return activityOf(last.toolCalls[last.toolCalls.length - 1], lang);
  return { mood: "working", label: ACT[lang].write! };
}

// ---------- approvals and decisions ----------

/** The decision payload for an approval card: every action allowed, or none ("Not now"). */
export function decisionsFor(items: ApprovalItem[], allow: boolean): Record<string, boolean> {
  return Object.fromEntries(items.map((it) => [it.call.id, allow]));
}

/** Actions that only the computer can do (its mouse and keyboard, its files): the card says so. */
export function needsComputerAction(it: ApprovalItem): boolean {
  const n = it.call.name;
  return !!it.desktop || n.startsWith("desktop_") || /(^|_)(file|files|folder|command)$/.test(n) || n === "run_command" || n.startsWith("read_computer") || n === "send_file_to_user";
}

// ---------- the phone's messages on their way ----------

export type Outgoing = { entryId: string; chatId: string; text: string; at: number; jobId?: string; state: "sending" | "sent" | "failed"; replyTo?: { id: string; who: string; text: string } };

/**
 * Messages sent from the phone that the chat does not show yet (the computer or the runner adds them). Matched by
 * entry id; when the computer kept its own id, by the same text sent around the same time, each chat message
 * matching one phone message only (two "ok" in a row stay two).
 */
export function pendingOutgoing(chat: Chat | undefined, outbox: Outgoing[]): Outgoing[] {
  const users = (chat?.entries ?? []).filter((e): e is UserEntry => e.kind === "user");
  const used = new Set<string>();
  for (const o of outbox) if (users.some((u) => u.id === o.entryId)) used.add(o.entryId);
  const left: Outgoing[] = [];
  for (const o of outbox) {
    if (used.has(o.entryId)) continue;
    const u = users.find((x) => !used.has(x.id) && !outbox.some((y) => y.entryId === x.id) && x.text.trim() === o.text.trim() && x.at >= o.at - 120_000);
    if (u) used.add(u.id);
    else left.push(o);
  }
  return left;
}

/** A short random id, like the desktop's entry ids. */
export function newId(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)];
  return `m${s}`;
}

// ---------- computer and sync ----------

export type ComputerState = "online" | "offline" | "none";

export function computerState(status: CloudStatus | null | undefined): { state: ComputerState; lastSeen: number | null; device?: CloudDevice } {
  const desktops = (status?.devices ?? []).filter((d) => d.kind === "desktop");
  if (!desktops.length) return { state: "none", lastSeen: null };
  const on = desktops.find((d) => d.online);
  if (on) return { state: "online", lastSeen: Date.parse(on.lastSeen) || null, device: on };
  const newest = desktops.reduce((a, b) => (Date.parse(b.lastSeen) > Date.parse(a.lastSeen) ? b : a));
  return { state: "offline", lastSeen: Date.parse(newest.lastSeen) || null, device: newest };
}

/**
 * What the chat waits for, for the banner above the composer:
 * needs_computer (a step only the computer can do: a job said so, or the runner's reply has that error code),
 * waiting (the phone's message is queued and no computer or runner took it yet), or null.
 */
export function chatBlocker(chat: Chat | undefined, jobs: JobInfo[], computer: ComputerState, hasOutgoing: boolean): "needs_computer" | "queued_offline" | null {
  if (jobs.some((j) => j.status === "needs_computer")) return "needs_computer";
  const lastBot = [...(chat?.entries ?? [])].reverse().find((e): e is BotEntry => e.kind === "bot");
  const lastUser = [...(chat?.entries ?? [])].reverse().find((e): e is UserEntry => e.kind === "user");
  if (lastBot?.errorCode === "needs_computer" && (!lastUser || lastBot.at >= lastUser.at)) return "needs_computer";
  if (hasOutgoing && computer !== "online" && jobs.some((j) => j.status === "queued")) return "queued_offline";
  return null;
}

export function syncUse(status: CloudStatus | null | undefined): number {
  if (!status || !status.limit) return 0;
  return Math.min(1, Math.max(0, status.bytes / status.limit));
}

// ---------- long-poll backoff ----------

/** Wait before the next try after `fails` failures in a row: 1 s, 2 s, 4 s … up to 30 s. */
export function backoffMs(fails: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, fails - 1));
}

// ---------- time stamps between messages ----------

/** A time stamp goes above a message when it is the first, on a new day, or after an hour of silence. */
export function needsStamp(prevAt: number | undefined, at: number, tzOffsetMin = 0): boolean {
  if (prevAt === undefined) return true;
  return startOfDay(prevAt, tzOffsetMin) !== startOfDay(at, tzOffsetMin) || at - prevAt > 3_600_000;
}

/** "Today 14:05", "Yesterday 09:12", "Monday 18:00", "3/10/26 18:00". */
export function stampLabel(at: number, now: number, lang: Lang, today: string, tzOffsetMin = 0, timeZone = "UTC"): string {
  const locale = lang === "ar" ? "ar-DZ" : lang === "fr" ? "fr-FR" : "en-US";
  const time = new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone, numberingSystem: "latn" });
  const sameDay = startOfDay(at, tzOffsetMin) === startOfDay(now, tzOffsetMin);
  return `${sameDay ? today : listTime(at, now, lang, tzOffsetMin, timeZone)} ${time}`;
}

/** Where to go after signing in: only a page of the phone app (never another site, never back to sign-in). */
export function safeMobileNext(raw: string | null | undefined): string {
  if (!raw || raw.includes("..") || raw.includes("\\") || raw.startsWith("/m/login")) return "/m";
  return /^\/m(\/[\w\-./%?=&]*)?$/.test(raw) ? raw : "/m";
}

// ---------- messenger habits (WhatsApp / Messenger): counts, archive, ticks ----------

/** How many replies came since the user last looked (the badge on the row), at most 99. */
export function unreadCount(chat: Chat, seenAt: number | undefined): number {
  if (seenAt === undefined) return 0;
  let n = 0;
  for (const e of chat.entries) if (e.kind === "bot" && e.status !== "running" && !e.held && e.text.trim() && e.at > seenAt) n++;
  return Math.min(99, n);
}

/** The archived chats leave the list; they are kept under "Archived". */
export function splitArchived<T extends { chat: Pick<Chat, "id"> }>(rows: T[], archived: string[]): { main: T[]; archived: T[] } {
  const set = new Set(archived);
  return { main: rows.filter((r) => !set.has(r.chat.id)), archived: rows.filter((r) => set.has(r.chat.id)) };
}

export const toggleArchive = (archived: string[], chatId: string): string[] => (archived.includes(chatId) ? archived.filter((a) => a !== chatId) : [...archived, chatId]);

/**
 * The ticks under the user's own message: "read" once a bot answered after it, "delivered" when it is in the
 * chat (the computer or the cloud has it). Messages still on their way use their Outgoing state.
 */
export function userTick(chat: Chat, entryId: string): "read" | "delivered" {
  const i = chat.entries.findIndex((e) => e.id === entryId);
  return i >= 0 && chat.entries.slice(i + 1).some((e) => e.kind === "bot") ? "read" : "delivered";
}

/** The time in a bubble: "14:05" / "2:05 PM". */
export function bubbleTime(at: number, lang: Lang, timeZone = "UTC"): string {
  const locale = lang === "ar" ? "ar-DZ" : lang === "fr" ? "fr-FR" : "en-US";
  return new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone, numberingSystem: "latn" });
}

/** A short quote of a message for a reply ("Nova: Here are the 3…"). */
export function quoteOf(text: string, max = 90): string {
  return plainPreview(text, max);
}
