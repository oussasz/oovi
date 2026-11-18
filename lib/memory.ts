// Long-term memory, Hermes-style: two small Markdown files the bots curate
// themselves with the `memory` tool.
//   USER.md   - who the user is: name, role, preferences, people, projects
//   MEMORY.md - notes and lessons: what worked, conventions, facts about the work
// Both are small on purpose (character limits) so they stay cheap to include in
// every prompt; when full, the bot must merge or remove entries first.
// Each bot reply gets a frozen snapshot at its start, which keeps the prompt
// prefix stable for provider-side prompt caching.

import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./settings";
import { WRONG_LESSON } from "./lesson-rules";

// KNOWLEDGE.md is different: reference notes the user writes in Settings > Memory & soul
// (company facts, product details, writing style). Bots read it but the memory tool can't change it.
export type MemoryTarget = "user" | "memory" | "knowledge";
export const LIMITS: Record<MemoryTarget, number> = { user: 1500, memory: 2500, knowledge: 5000 };
const FILES: Record<MemoryTarget, string> = { user: "USER.md", memory: "MEMORY.md", knowledge: "KNOWLEDGE.md" };
export const isMemoryTarget = (x: unknown): x is MemoryTarget => x === "user" || x === "memory" || x === "knowledge";
const SEP = "\n§\n";

const file = (t: MemoryTarget) => path.join(dataDir(), "memory", FILES[t]);

export function readEntries(t: MemoryTarget): string[] {
  try {
    return fs
      .readFileSync(file(t), "utf8")
      .split(/\r?\n§\r?\n/)
      .map((e) => e.trim())
      // Drop wrong "blank page = site down" rules an older version may have saved (lib/lesson-rules.ts).
      .filter((e) => e && !WRONG_LESSON.test(e));
  } catch {
    return [];
  }
}

function writeEntries(t: MemoryTarget, entries: string[]) {
  fs.mkdirSync(path.dirname(file(t)), { recursive: true });
  fs.writeFileSync(file(t), entries.join(SEP) + (entries.length ? "\n" : ""));
}

export const readRaw = (t: MemoryTarget) => readEntries(t).join(SEP);

/** When a memory file last changed (ms), or null if it doesn't exist yet. */
export function updatedAt(t: MemoryTarget): number | null {
  try {
    return fs.statSync(file(t)).mtimeMs;
  } catch {
    return null;
  }
}

/** Replace a whole file (the Library editor and backups use this). */
export function writeRaw(t: MemoryTarget, text: string) {
  const entries = text
    .split(/\r?\n§\r?\n/)
    .map((e) => e.trim())
    .filter(Boolean);
  writeEntries(t, entries);
}

const size = (entries: string[]) => entries.join(SEP).length;

// Memory is read back into every prompt, so refuse text that tries to give orders.
export const SUSPICIOUS = /(ignore (all|any|previous|prior)|disregard (the|all|previous)|system prompt|you are now|new instructions|api[_ -]?key|password\s*[:=])/i;

/** The memory tool. Returns a short result message for the model. */
export function applyMemory(action: string, target: string, content?: string, oldText?: string, by?: { botId?: string; source?: string }): string {
  // "mine": this bot's own notes (its role, its way of working): only it reads them.
  if (target === "mine") {
    if (!by?.botId) return 'target "mine" is only for a bot\'s own notes.';
    return applyBotNotes(by.botId, action, content, oldText, by.source);
  }
  if (target !== "user" && target !== "memory") return 'target must be "user", "memory" or "mine".';
  const t = target as MemoryTarget;
  const entries = readEntries(t);
  const log = (act: string, before?: string, after?: string) => journal({ target: t, action: act, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), ...(by?.botId ? { botId: by.botId } : {}), source: by?.source ?? "bot" });
  const text = (content ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 600);

  if (action === "add") {
    if (!text) return "Nothing to add.";
    if (SUSPICIOUS.test(text)) return "Not saved: memory can't store instructions or secrets.";
    if (WRONG_LESSON.test(text)) return "Not saved: a blank or slow page doesn't prove a site is down, so this can't be remembered as a rule.";
    if (entries.some((e) => e.toLowerCase() === text.toLowerCase())) return "Already remembered.";
    const next = [...entries, text];
    if (size(next) > LIMITS[t]) {
      return `Not saved: ${FILES[t]} is full (${size(entries)}/${LIMITS[t]} chars). Merge related entries with "replace" or drop stale ones with "remove", then add again.`;
    }
    writeEntries(t, next);
    log("add", undefined, text);
    return `Saved to ${FILES[t]} (${size(next)}/${LIMITS[t]} chars).`;
  }

  const needle = (oldText ?? "").trim().toLowerCase();
  if (!needle) return "old_text is required to find the entry.";
  const i = entries.findIndex((e) => e.toLowerCase().includes(needle));
  if (i < 0) return `No entry in ${FILES[t]} contains "${oldText}".`;

  if (action === "remove") {
    const [gone] = entries.splice(i, 1);
    writeEntries(t, entries);
    log("remove", gone);
    return `Removed from ${FILES[t]}.`;
  }
  if (action === "replace") {
    if (!text) return "content is required for replace.";
    if (SUSPICIOUS.test(text)) return "Not saved: memory can't store instructions or secrets.";
    if (WRONG_LESSON.test(text)) return "Not saved: a blank or slow page doesn't prove a site is down, so this can't be remembered as a rule.";
    const next = [...entries];
    const before = next[i];
    next[i] = text;
    if (size(next) > LIMITS[t]) return `Not saved: that would exceed ${LIMITS[t]} chars. Shorten it.`;
    writeEntries(t, next);
    log("replace", before, text);
    return `Updated ${FILES[t]} (${size(next)}/${LIMITS[t]} chars).`;
  }
  return 'action must be "add", "replace" or "remove".';
}

const bullets = (entries: string[]) => entries.map((e) => `- ${e.replace(/\n/g, "\n  ")}`);

/** The user's reference knowledge for the system prompt (empty when there's none). Capped by LIMITS.knowledge. */
export function knowledgePrompt(): string {
  const k = readEntries("knowledge");
  if (!k.length) return "";
  return ["Reference knowledge from the user (always true; read-only, the memory tool can't change it):", ...bullets(k)].join("\n").slice(0, LIMITS.knowledge + 400);
}

/** Memory block for the system prompt (empty when there's nothing yet). Includes the user's knowledge notes. */
export function memoryPrompt(): string {
  const user = readEntries("user");
  const mem = readEntries("memory");
  const parts: string[] = [];
  if (user.length) parts.push(`About the user (USER.md, ${size(user)}/${LIMITS.user} chars):`, ...bullets(user));
  if (mem.length) parts.push(`Notes (MEMORY.md, ${size(mem)}/${LIMITS.memory} chars):`, ...bullets(mem));
  const k = knowledgePrompt();
  if (k) parts.push(k);
  return parts.join("\n");
}

// ---------- each bot's own notes ----------

export const BOT_NOTES_LIMIT = 1500;
const botFile = (botId: string) => path.join(dataDir(), "memory", "bots", `${botId.replace(/[^\w-]/g, "").slice(0, 40)}.md`);

export function readBotNotes(botId: string): string[] {
  try {
    return fs.readFileSync(botFile(botId), "utf8").split(/\r?\n§\r?\n/).map((e) => e.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
function writeBotNotes(botId: string, entries: string[]) {
  fs.mkdirSync(path.dirname(botFile(botId)), { recursive: true });
  fs.writeFileSync(botFile(botId), entries.join(SEP) + (entries.length ? "\n" : ""));
}

function applyBotNotes(botId: string, action: string, content?: string, oldText?: string, source?: string): string {
  const entries = readBotNotes(botId);
  const text = (content ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 600);
  const log = (act: string, before?: string, after?: string) => journal({ target: "mine", botId, action: act, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), source: source ?? "bot" });
  if (action === "add") {
    if (!text) return "Nothing to add.";
    if (SUSPICIOUS.test(text)) return "Not saved: memory can't store instructions or secrets.";
    if (entries.some((e) => e.toLowerCase() === text.toLowerCase())) return "Already in your notes.";
    const next = [...entries, text];
    if (size(next) > BOT_NOTES_LIMIT) return `Not saved: your notes are full (${size(entries)}/${BOT_NOTES_LIMIT} chars). Merge or remove notes first.`;
    writeBotNotes(botId, next);
    log("add", undefined, text);
    return `Saved to your own notes (${size(next)}/${BOT_NOTES_LIMIT} chars).`;
  }
  const needle = (oldText ?? "").trim().toLowerCase();
  if (!needle) return "old_text is required to find the note.";
  const i = entries.findIndex((e) => e.toLowerCase().includes(needle));
  if (i < 0) return `None of your notes contains "${oldText}".`;
  if (action === "remove") {
    const [gone] = entries.splice(i, 1);
    writeBotNotes(botId, entries);
    log("remove", gone);
    return "Removed from your notes.";
  }
  if (action === "replace") {
    if (!text || SUSPICIOUS.test(text)) return "Not saved.";
    const before = entries[i];
    entries[i] = text;
    if (size(entries) > BOT_NOTES_LIMIT) return "Not saved: too long.";
    writeBotNotes(botId, entries);
    log("replace", before, text);
    return "Updated your notes.";
  }
  return 'action must be "add", "replace" or "remove".';
}

/** A bot's own notes for its instructions (empty when it has none). */
export function botNotesPrompt(botId: string): string {
  const n = readBotNotes(botId);
  return n.length ? [`Your own notes (only you see them; the memory tool with target "mine", ${size(n)}/${BOT_NOTES_LIMIT} chars):`, ...bullets(n)].join("\n") : "";
}

// ---------- the journal: every change, with undo ----------

export type JournalEntry = { id: string; at: number; target: MemoryTarget | "mine"; botId?: string; action: string; before?: string; after?: string; source: string; undone?: boolean };
const journalFile = () => path.join(dataDir(), "memory", "journal.json");
const JOURNAL_MAX = 200;

export function readJournal(): JournalEntry[] {
  try {
    const j = JSON.parse(fs.readFileSync(journalFile(), "utf8")) as { entries?: JournalEntry[] };
    return Array.isArray(j.entries) ? j.entries : [];
  } catch {
    return [];
  }
}

function journal(e: Omit<JournalEntry, "id" | "at">) {
  try {
    const all = readJournal();
    all.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...e });
    fs.mkdirSync(path.dirname(journalFile()), { recursive: true });
    fs.writeFileSync(journalFile(), JSON.stringify({ entries: all.slice(-JOURNAL_MAX) }));
  } catch {
    /* the journal never blocks a save */
  }
}

/** Undo one change: an added line goes, a removed one comes back, a replaced one gets its old words back. */
export function undoChange(id: string): string | null {
  const all = readJournal();
  const e = all.find((x) => x.id === id);
  if (!e || e.undone) return "That change can't be undone (already undone, or too old).";
  const read = () => (e.target === "mine" ? readBotNotes(e.botId ?? "") : readEntries(e.target));
  const write = (list: string[]) => (e.target === "mine" ? writeBotNotes(e.botId ?? "", list) : writeEntries(e.target, list));
  const list = read();
  if (e.action === "add") {
    const i = list.findIndex((x) => x === e.after);
    if (i < 0) return "That line isn't there any more.";
    list.splice(i, 1);
  } else if (e.action === "remove") {
    if (e.before && !list.includes(e.before)) list.push(e.before);
  } else if (e.action === "replace") {
    const i = list.findIndex((x) => x === e.after);
    if (i < 0 || e.before === undefined) return "That line has changed since: edit it by hand.";
    list[i] = e.before;
  } else return "That change can't be undone.";
  write(list);
  e.undone = true;
  fs.writeFileSync(journalFile(), JSON.stringify({ entries: all }));
  return null;
}
