// File-based storage. Small, readable JSON so people can back it up or inspect it.
//   data/bots.json          all bots
//   data/chats/<id>.json    one file per chat (groups and 1:1 chats)
//   data/shots/<id>.jpg     browser screenshots

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { cleanFace } from "./faces";
import { NAME_RE } from "./mentions";
import { PROVIDERS, type ProviderId } from "./providers-meta";
import { dataDir } from "./settings";
import type { Bot, BotInput, Chat, ChatSummary } from "./types";

export const ID_RE = /^[\w-]{1,80}$/;
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

const botsFile = () => path.join(dataDir(), "bots.json");
const chatsDir = () => path.join(dataDir(), "chats");
const shotsDir = () => path.join(dataDir(), "shots");

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

// ---------- seed: a small crew so the app is useful on first run ----------

function seed(): Bot[] {
  const now = Date.now();
  const bots: Bot[] = [
    {
      id: newId(),
      name: "Oovi",
      role: "Team leader & personal assistant",
      instructions:
        "You are the user's personal assistant and the leader of their team. Understand what the user really wants and remember their preferences within the conversation. Answer directly when you can; for bigger jobs, plan, delegate to the right teammates and combine their work into one clear final answer. Always end with a clear result or next step.",
      face: { color: 8, shape: 0, hair: 0, eyes: 0, nose: 0, mouth: 1, cheeks: 1, top: 0, wear: 0 },
      tools: { web: true, browser: true },
      createdAt: now - 1,
    },
    {
      id: newId(),
      name: "Scout",
      role: "Researcher",
      instructions: "Find accurate, current information on the web. Check more than one source and always list the URLs you used. Keep notes short and factual.",
      face: { color: 0, shape: 0, hair: 1, eyes: 0, nose: 1, mouth: 0, cheeks: 1, top: 0, wear: 1 },
      tools: { web: true, browser: true },
      createdAt: now,
    },
    {
      id: newId(),
      name: "Quill",
      role: "Writer",
      instructions: "Turn research and ideas into clear, well-structured writing. Match the tone the user asks for. Use short paragraphs and headings when it helps.",
      face: { color: 1, shape: 2, hair: 3, eyes: 1, nose: 0, mouth: 1, cheeks: 1, top: 2, wear: 0 },
      tools: { web: false, browser: false },
      createdAt: now + 1,
    },
    {
      id: newId(),
      name: "Nova",
      role: "Critic",
      instructions: "Review work from the user or teammates. Point out errors, gaps and risks, then suggest concrete fixes. Be direct but kind.",
      face: { color: 2, shape: 1, hair: 2, eyes: 2, nose: 2, mouth: 3, cheeks: 2, top: 0, wear: 0 },
      tools: { web: true, browser: false },
      createdAt: now + 2,
    },
  ];
  writeJson(botsFile(), { bots });
  const studio: Chat = {
    id: newId(),
    kind: "group",
    name: "Studio",
    memberIds: bots.map((b) => b.id),
    leadId: bots[0]?.id,
    orchestrate: true,
    createdAt: now,
    updatedAt: now,
    entries: [],
  };
  writeJson(path.join(chatsDir(), `${studio.id}.json`), studio);
  return bots;
}

// ---------- bots ----------

export function listBots(): Bot[] {
  const j = readJson<{ bots: Bot[] }>(botsFile());
  return j ? j.bots : seed();
}

export function getBot(id: string): Bot | undefined {
  return listBots().find((b) => b.id === id);
}

/** Returns a clean BotInput, or an error message for the user. */
export function validateBot(input: unknown, selfId?: string): BotInput | string {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  if (!NAME_RE.test(name)) return "Name must be one word (letters, numbers, - or _), up to 24 characters, so it can be @mentioned.";
  if (["all", "everyone", "user", "you"].includes(name.toLowerCase())) return `"${name}" is reserved. Pick another name.`;
  if (listBots().some((b) => b.id !== selfId && b.name.toLowerCase() === name.toLowerCase())) return `There's already a bot called ${name}.`;
  const provider = typeof o.provider === "string" && o.provider in PROVIDERS ? (o.provider as ProviderId) : undefined;
  const tools = (o.tools && typeof o.tools === "object" ? o.tools : {}) as Record<string, unknown>;
  return {
    name,
    role: String(o.role ?? "").trim().slice(0, 40),
    instructions: String(o.instructions ?? "").trim().slice(0, 6000),
    face: cleanFace(o.face),
    provider,
    model: provider && typeof o.model === "string" && o.model.trim() ? o.model.trim().slice(0, 120) : undefined,
    tools: {
      web: tools.web === true,
      browser: tools.browser === true,
      accounts: tools.browser === true && tools.accounts === true,
      mcp: Array.isArray(tools.mcp) ? tools.mcp.filter((x): x is string => typeof x === "string" && /^[\w-]{1,40}$/.test(x)).slice(0, 20) : [],
    },
  };
}

export function createBot(input: BotInput): Bot {
  const bot: Bot = { ...input, id: newId(), createdAt: Date.now() };
  writeJson(botsFile(), { bots: [...listBots(), bot] });
  return bot;
}

export function updateBot(id: string, input: BotInput): Bot | null {
  const bots = listBots();
  const i = bots.findIndex((b) => b.id === id);
  const cur = bots[i];
  if (!cur) return null;
  const next: Bot = { ...cur, ...input, id, createdAt: cur.createdAt };
  bots[i] = next;
  writeJson(botsFile(), { bots });
  return next;
}

/** Point bots that use a retired model at its replacement. */
export function replaceBotModel(provider: ProviderId, dead: string, replacement: string): void {
  const bots = listBots();
  let changed = false;
  for (const b of bots) {
    if (b.provider === provider && b.model === dead) {
      b.model = replacement;
      changed = true;
    }
  }
  if (changed) writeJson(botsFile(), { bots });
}

export function deleteBot(id: string): void {
  writeJson(botsFile(), { bots: listBots().filter((b) => b.id !== id) });
  for (const c of listChats()) {
    if (c.id === dmId(id)) {
      deleteChat(c.id);
    } else if (c.memberIds.includes(id)) {
      c.memberIds = c.memberIds.filter((m) => m !== id);
      if (c.leadId === id) c.leadId = c.memberIds[0];
      saveChat(c);
    }
  }
}

// ---------- chats ----------

export const dmId = (botId: string) => `dm-${botId}`;
const chatFile = (id: string) => path.join(chatsDir(), `${id}.json`);

export function getChat(id: string): Chat | null {
  if (!ID_RE.test(id)) return null;
  const c = readJson<Chat>(chatFile(id));
  if (c) return c;
  if (id.startsWith("dm-")) {
    const bot = getBot(id.slice(3));
    if (!bot) return null;
    const now = Date.now();
    const dm: Chat = { id, kind: "direct", name: "", memberIds: [bot.id], leadId: bot.id, createdAt: now, updatedAt: now, entries: [] };
    writeJson(chatFile(id), dm);
    return dm;
  }
  return null;
}

export function saveChat(chat: Chat): void {
  chat.updatedAt = Date.now();
  writeJson(chatFile(chat.id), chat);
}

export function listChats(): Chat[] {
  listBots(); // make sure the seed exists
  let files: string[] = [];
  try {
    files = fs.readdirSync(chatsDir()).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  return files.map((f) => readJson<Chat>(path.join(chatsDir(), f))).filter((c): c is Chat => !!c);
}

export function summarize(c: Chat, bots: Bot[], running: boolean): ChatSummary {
  const last = c.entries.at(-1);
  let preview = "";
  if (last?.kind === "user") preview = `You: ${last.text}`;
  else if (last?.kind === "bot") {
    const who = bots.find((b) => b.id === last.botId)?.name ?? "Bot";
    preview = last.text ? `${c.kind === "group" ? `${who}: ` : ""}${last.text}` : last.status === "waiting"
        ? `${who} needs your OK`
        : last.status === "error"
          ? `${who} couldn't reply`
          : last.status === "stopped"
            ? `${who} stopped`
            : `${who} is working…`;
  }
  const name = c.kind === "direct" ? (bots.find((b) => b.id === c.memberIds[0])?.name ?? "Bot") : c.name;
  return {
    id: c.id,
    kind: c.kind,
    name,
    memberIds: c.memberIds,
    leadId: c.leadId,
    updatedAt: c.updatedAt,
    preview: preview
      .replace(/\*\*|__|`|^#+\s*/gm, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .slice(0, 90),
    running,
    waiting: !!(c.pending?.approval || c.pending?.planReview),
  };
}

/** Returns a clean group definition, or an error message. */
export function validateGroup(input: unknown): { name: string; memberIds: string[]; leadId?: string; orchestrate: boolean } | string {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = String(o.name ?? "").trim().slice(0, 48);
  if (!name) return "Give the group a name.";
  const known = new Set(listBots().map((b) => b.id));
  const memberIds = Array.isArray(o.memberIds) ? [...new Set(o.memberIds.map(String))].filter((id) => known.has(id)) : [];
  if (!memberIds.length) return "Add at least one bot to the group.";
  const leadId = typeof o.leadId === "string" && memberIds.includes(o.leadId) ? o.leadId : memberIds[0];
  return { name, memberIds, leadId, orchestrate: o.orchestrate !== false };
}

export function createGroup(g: { name: string; memberIds: string[]; leadId?: string; orchestrate?: boolean }): Chat {
  const now = Date.now();
  const chat: Chat = { id: newId(), kind: "group", ...g, createdAt: now, updatedAt: now, entries: [] };
  writeJson(chatFile(chat.id), chat);
  return chat;
}

export function deleteChat(id: string): void {
  if (!ID_RE.test(id)) return;
  fs.rmSync(chatFile(id), { force: true });
}

// ---------- screenshots ----------

/** prefix: marks a kind of screenshot ("desk-" for desktop control) so it can be cleaned up on its own schedule. */
export function saveShot(jpeg: Buffer, prefix = ""): string {
  const id = `${prefix}${newId()}`;
  fs.mkdirSync(shotsDir(), { recursive: true });
  fs.writeFileSync(path.join(shotsDir(), `${id}.jpg`), jpeg);
  return `/api/shots/${id}`;
}

/** Deletes screenshots whose id starts with `prefix` and that are older than maxAgeMs. Returns how many. */
export function sweepShots(prefix: string, maxAgeMs: number): number {
  if (!prefix) return 0;
  let n = 0;
  const cutoff = Date.now() - maxAgeMs;
  let names: string[] = [];
  try {
    names = fs.readdirSync(shotsDir());
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".jpg")) continue;
    const p = path.join(shotsDir(), name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.rmSync(p, { force: true });
        n++;
      }
    } catch {
      /* gone already */
    }
  }
  return n;
}

export function readShot(id: string): Buffer | null {
  if (!ID_RE.test(id)) return null;
  try {
    return fs.readFileSync(path.join(shotsDir(), `${id}.jpg`));
  } catch {
    return null;
  }
}
