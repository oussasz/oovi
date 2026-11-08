// Backup / restore of everything in this account, as one JSON file.
// API keys and MCP secrets are NOT included (re-enter them after restoring).

import fs from "node:fs";
import path from "node:path";
import { listServers } from "./mcp";
import { readRaw, writeRaw } from "./memory";
import { dataDir, publicSettings, updateSettings } from "./settings";
import { listSkills, saveSkill } from "./skills";
import { listBots, listChats, saveChat } from "./store";
import type { Bot, Chat } from "./types";

export type Bundle = {
  format: "oovi-backup";
  version: 1;
  exportedAt: string;
  bots: Bot[];
  chats: Chat[];
  skills: { name: string; description: string; body: string; source?: string }[];
  memory: { user: string; memory: string };
  mcp: { name: string; transport: string; command?: string; args?: string[]; url?: string; envKeys: string[]; headerKeys: string[] }[];
  settings: Record<string, unknown>;
};

export function exportBundle(): Bundle {
  const s = publicSettings();
  return {
    format: "oovi-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    bots: listBots(),
    chats: listChats(),
    skills: listSkills().map((k) => ({ name: k.name, description: k.description, body: k.body, source: k.source })),
    memory: { user: readRaw("user"), memory: readRaw("memory") },
    mcp: listServers().map((m) => ({ name: m.name, transport: m.transport, command: m.command, args: m.args, url: m.url, envKeys: Object.keys(m.env ?? {}), headerKeys: Object.keys(m.headers ?? {}) })),
    settings: { active: s.active, fallbacks: s.fallbacks, search: { provider: s.search.provider, searxngUrl: s.search.searxngUrl }, browser: s.browser, approvals: s.approvals, maxSteps: s.maxSteps, maxTurns: s.maxTurns, language: s.language, crashReports: s.crashReports },
  };
}

/** Restore: bots, chats and skills with the same id/name are replaced; others are kept. */
export function importBundle(raw: unknown): { bots: number; chats: number; skills: number } {
  const b = raw as Partial<Bundle> | null;
  if (!b || b.format !== "oovi-backup" || b.version !== 1) throw new Error("This isn't an oovi backup file.");

  const bots = Array.isArray(b.bots) ? b.bots.filter((x) => x && typeof x.id === "string" && typeof x.name === "string") : [];
  if (bots.length) {
    const byId = new Map(listBots().map((x) => [x.id, x]));
    for (const bot of bots) byId.set(bot.id, bot);
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(path.join(dataDir(), "bots.json"), JSON.stringify({ bots: [...byId.values()] }, null, 1));
  }

  const chats = Array.isArray(b.chats) ? b.chats.filter((c) => c && typeof c.id === "string" && /^[\w-]{1,80}$/.test(c.id) && Array.isArray(c.entries)) : [];
  for (const c of chats) saveChat(c);

  let skills = 0;
  for (const k of Array.isArray(b.skills) ? b.skills : []) {
    try {
      saveSkill({ name: String(k.name), description: String(k.description), body: String(k.body), source: k.source });
      skills++;
    } catch {
      /* skip invalid skill */
    }
  }

  if (b.memory) {
    if (typeof b.memory.user === "string") writeRaw("user", b.memory.user);
    if (typeof b.memory.memory === "string") writeRaw("memory", b.memory.memory);
  }
  if (b.settings && typeof b.settings === "object") updateSettings(b.settings as Parameters<typeof updateSettings>[0]);

  return { bots: bots.length, chats: chats.length, skills };
}
