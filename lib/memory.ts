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

export type MemoryTarget = "user" | "memory";
export const LIMITS: Record<MemoryTarget, number> = { user: 1500, memory: 2500 };
const FILES: Record<MemoryTarget, string> = { user: "USER.md", memory: "MEMORY.md" };
const SEP = "\n§\n";

const file = (t: MemoryTarget) => path.join(dataDir(), "memory", FILES[t]);

export function readEntries(t: MemoryTarget): string[] {
  try {
    return fs
      .readFileSync(file(t), "utf8")
      .split(/\r?\n§\r?\n/)
      .map((e) => e.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeEntries(t: MemoryTarget, entries: string[]) {
  fs.mkdirSync(path.dirname(file(t)), { recursive: true });
  fs.writeFileSync(file(t), entries.join(SEP) + (entries.length ? "\n" : ""));
}

export const readRaw = (t: MemoryTarget) => readEntries(t).join(SEP);

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
export function applyMemory(action: string, target: string, content?: string, oldText?: string): string {
  if (target !== "user" && target !== "memory") return 'target must be "user" or "memory".';
  const t = target as MemoryTarget;
  const entries = readEntries(t);
  const text = (content ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 600);

  if (action === "add") {
    if (!text) return "Nothing to add.";
    if (SUSPICIOUS.test(text)) return "Not saved: memory can't store instructions or secrets.";
    if (entries.some((e) => e.toLowerCase() === text.toLowerCase())) return "Already remembered.";
    const next = [...entries, text];
    if (size(next) > LIMITS[t]) {
      return `Not saved: ${FILES[t]} is full (${size(entries)}/${LIMITS[t]} chars). Merge related entries with "replace" or drop stale ones with "remove", then add again.`;
    }
    writeEntries(t, next);
    return `Saved to ${FILES[t]} (${size(next)}/${LIMITS[t]} chars).`;
  }

  const needle = (oldText ?? "").trim().toLowerCase();
  if (!needle) return "old_text is required to find the entry.";
  const i = entries.findIndex((e) => e.toLowerCase().includes(needle));
  if (i < 0) return `No entry in ${FILES[t]} contains "${oldText}".`;

  if (action === "remove") {
    entries.splice(i, 1);
    writeEntries(t, entries);
    return `Removed from ${FILES[t]}.`;
  }
  if (action === "replace") {
    if (!text) return "content is required for replace.";
    if (SUSPICIOUS.test(text)) return "Not saved: memory can't store instructions or secrets.";
    const next = [...entries];
    next[i] = text;
    if (size(next) > LIMITS[t]) return `Not saved: that would exceed ${LIMITS[t]} chars. Shorten it.`;
    writeEntries(t, next);
    return `Updated ${FILES[t]} (${size(next)}/${LIMITS[t]} chars).`;
  }
  return 'action must be "add", "replace" or "remove".';
}

/** Memory block for the system prompt (empty when there's nothing yet). */
export function memoryPrompt(): string {
  const user = readEntries("user");
  const mem = readEntries("memory");
  const parts: string[] = [];
  if (user.length) parts.push(`About the user (USER.md, ${size(user)}/${LIMITS.user} chars):`, ...user.map((e) => `- ${e.replace(/\n/g, "\n  ")}`));
  if (mem.length) parts.push(`Notes (MEMORY.md, ${size(mem)}/${LIMITS.memory} chars):`, ...mem.map((e) => `- ${e.replace(/\n/g, "\n  ")}`));
  return parts.join("\n");
}
