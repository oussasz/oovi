// Setup sync: the user's oovi setup follows their account to every computer they sign in on.
// What travels: bots, groups (who is in them, not their messages), skills, routines, connectors (never
// their keys), a few settings, the main bot, and what the bots learned about the user (profile, notes,
// knowledge, lessons). What never travels: chats and their files, API keys and connector keys, and
// anything tied to one computer (project folders, browser setup, the model chosen with a local key).
//
// How: the account keeps one copy (GET/PUT /api/v1/setup, with a version number). This computer merges
// it with its own, item by item (lib/setup-sync-core.ts), applies what changed, and sends the result back.
// It runs at start, every few minutes, and when the user signs in on a new computer (before the first-run
// screens, which are skipped when the account already has a setup).
// A routine that arrives from another computer is paused here, so it never runs twice.
// It belongs to the account (signed out: nothing is synced) and never throws.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cloud, CloudError, sessionToken } from "./account";
import { cleanFace } from "./faces";
import { deleteLesson, importLessons, listLessons } from "./learning";
import { importServer, listServers, removeServer } from "./mcp";
import { readRaw as readMemory, writeRaw as writeMemory, type MemoryTarget } from "./memory";
import { deleteRoutine, importRoutines, listRoutines } from "./routines";
import { baseOf, isEmptySetup, itemHash, mergeSetup, uniqueBotNames, type SetupBase, type SetupItems } from "./setup-sync-core";
import { dataDir, publicSettings, updateSettings } from "./settings";
import { deleteSkill, listSkills, saveSkill } from "./skills";
import { deleteBot, deleteChat, dmId, getChat, listBots, listChats, saveChat } from "./store";
import { mainBot, pinMainBot } from "./team";
import type { Bot, Chat } from "./types";

const stateFile = () => path.join(dataDir(), "setup-sync.json");
const onboardingFile = () => path.join(dataDir(), "onboarding.json");
type State = { version: number; base: SetupBase; at: number };
const MEMORY: MemoryTarget[] = ["user", "memory", "knowledge"];
const STARTER_NAMES = ["Oovi", "Scout", "Quill", "Nova"];

function readState(): State | null {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as State;
    return typeof j.version === "number" && j.base && typeof j.base === "object" ? j : null;
  } catch {
    return null;
  }
}
function writeState(s: State) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(s));
}

// ---------- this computer's setup, as items ----------

const groupItem = (c: Chat) => ({ name: c.name, memberIds: c.memberIds, ...(c.leadId ? { leadId: c.leadId } : {}), orchestrate: c.orchestrate !== false, createdAt: c.createdAt });

export function collectSetup(): SetupItems {
  const items: SetupItems = {};
  for (const b of listBots()) items[`bot:${b.id}`] = b;
  for (const c of listChats()) if (c.kind === "group" && !c.routine) items[`group:${c.id}`] = groupItem(c);
  for (const k of listSkills()) items[`skill:${k.slug}`] = { name: k.name, description: k.description, body: k.body, ...(k.source ? { source: k.source } : {}) };
  for (const r of listRoutines()) items[`routine:${r.id}`] = { name: r.name, botId: r.botId, prompt: r.prompt, schedule: r.schedule, timezone: r.timezone, notifyTelegram: r.notifyTelegram, createdAt: r.createdAt, ...(r.quiet ? { quiet: true } : {}), ...(r.watch ? { watch: { url: r.watch.url } } : {}) };
  for (const l of listLessons()) items[`lesson:${l.id}`] = { text: l.text, ...(l.botId ? { botId: l.botId } : {}), source: l.source, createdAt: l.createdAt };
  for (const m of listServers())
    items[`mcp:${m.id}`] = { name: m.name, transport: m.transport, ...(m.command ? { command: m.command } : {}), ...(m.args?.length ? { args: m.args } : {}), ...(m.url ? { url: m.url } : {}), ...(m.auth ? { auth: m.auth } : {}), envKeys: Object.keys(m.env ?? {}), headerKeys: Object.keys(m.headers ?? {}), enabled: m.enabled, trusted: m.trusted, createdAt: m.createdAt };
  for (const t of MEMORY) {
    const text = readMemory(t);
    if (text.trim()) items[`memory:${t}`] = text;
  }
  const s = publicSettings();
  items.settings = { approvals: s.approvals, maxSteps: s.maxSteps, maxTurns: s.maxTurns, language: s.language, crashReports: s.crashReports, learning: s.learning };
  const main = mainBot();
  if (main) items.main = main.id;
  return items;
}

/** The first bots and group a new computer makes by itself, unused: never added to the account. */
function dropUntouchedStarter(items: SetupItems): SetupItems {
  const bots = Object.entries(items).filter(([k]) => k.startsWith("bot:"));
  const groups = Object.entries(items).filter(([k]) => k.startsWith("group:"));
  const onlyStarter = bots.length > 0 && bots.every(([, b]) => STARTER_NAMES.includes((b as Bot).name) && !getChat(dmId((b as Bot).id))?.entries.length);
  const studioUnused = groups.every(([k, g]) => (g as { name: string }).name === "Studio" && !getChat(k.slice(6))?.entries.length);
  if (!onlyStarter || !studioUnused) return items;
  return Object.fromEntries(Object.entries(items).filter(([k]) => !k.startsWith("bot:") && !k.startsWith("group:") && k !== "main"));
}

// ---------- applying the merged setup here ----------

async function applySetup(local: SetupItems, next: SetupItems): Promise<void> {
  const changed = (k: string) => (k in next ? !(k in local) || itemHash(local[k]) !== itemHash(next[k]) : k in local);
  const keys = [...new Set([...Object.keys(local), ...Object.keys(next)])].filter(changed);
  if (!keys.length) return;
  const of = (prefix: string) => keys.filter((k) => k.startsWith(prefix));

  // Bots: one write of the whole list; removed ones go through deleteBot (their direct chat, group seats).
  if (of("bot:").length) {
    const kept = Object.entries(next)
      .filter(([k]) => k.startsWith("bot:"))
      .map(([k, v]) => ({ ...(v as Bot), id: k.slice(4), face: cleanFace((v as Bot).face) }))
      .filter((b) => typeof b.name === "string" && b.name && typeof b.instructions === "string")
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    for (const k of of("bot:")) if (!(k in next)) deleteBot(k.slice(4));
    fs.writeFileSync(path.join(dataDir(), "bots.json"), JSON.stringify({ bots: kept }, null, 1));
  }
  const botIds = new Set(listBots().map((b) => b.id));

  for (const k of of("group:")) {
    const id = k.slice(6);
    if (!(k in next)) {
      deleteChat(id);
      continue;
    }
    const g = next[k] as ReturnType<typeof groupItem>;
    const memberIds = (Array.isArray(g.memberIds) ? g.memberIds : []).filter((m) => botIds.has(m));
    if (!memberIds.length) continue;
    const cur = getChat(id);
    const now = Date.now();
    const chat: Chat = cur
      ? { ...cur, name: g.name, memberIds, leadId: g.leadId && memberIds.includes(g.leadId) ? g.leadId : memberIds[0], orchestrate: g.orchestrate }
      : { id, kind: "group", name: String(g.name).slice(0, 60), memberIds, leadId: g.leadId && memberIds.includes(g.leadId) ? g.leadId : memberIds[0], orchestrate: g.orchestrate, createdAt: g.createdAt ?? now, updatedAt: now, entries: [] };
    saveChat(chat);
  }

  for (const k of of("skill:")) {
    const slug = k.slice(6);
    if (!(k in next)) deleteSkill(slug);
    else {
      const s = next[k] as { name: string; description: string; body: string; source?: string };
      try {
        saveSkill({ ...s, slug });
      } catch {
        /* an invalid skill is skipped */
      }
    }
  }

  const routinesIn = of("routine:").filter((k) => k in next);
  for (const k of of("routine:")) if (!(k in next)) deleteRoutine(k.slice(8));
  if (routinesIn.length) {
    const here = new Map(listRoutines().map((r) => [r.id, r]));
    // Paused unless it already runs here: one computer runs a routine, the user picks which.
    // Its chat (the runs' messages) belongs to each computer: an existing one is kept, a new one is made.
    importRoutines(routinesIn.map((k) => ({ ...(next[k] as object), id: k.slice(8), chatId: here.get(k.slice(8))?.chatId ?? randomBytes(6).toString("hex"), enabled: here.get(k.slice(8))?.enabled === true })));
  }

  const lessonsIn = of("lesson:").filter((k) => k in next);
  for (const k of of("lesson:")) if (!(k in next)) deleteLesson(k.slice(7));
  if (lessonsIn.length) {
    const here = new Map(listLessons().map((l) => [l.id, l]));
    importLessons(lessonsIn.map((k) => ({ score: 1, updatedAt: Date.now(), ...here.get(k.slice(7)), ...(next[k] as object), id: k.slice(7) })));
  }

  for (const k of of("mcp:")) {
    const id = k.slice(4);
    if (!(k in next)) await removeServer(id).catch(() => {});
    else if (!(k in local)) importServer({ ...(next[k] as Parameters<typeof importServer>[0]), id });
    // A connector changed elsewhere keeps its keys here: only new ones are added.
  }

  for (const t of MEMORY) if (changed(`memory:${t}`)) writeMemory(t, typeof next[`memory:${t}`] === "string" ? (next[`memory:${t}`] as string) : "");
  if (changed("settings") && next.settings && typeof next.settings === "object") updateSettings(next.settings as Parameters<typeof updateSettings>[0]);
  if (changed("main") && typeof next.main === "string" && botIds.has(next.main)) pinMainBot(next.main);
}

// ---------- talking to the account ----------

type Remote = { version: number; items: SetupItems | null };
const g = globalThis as typeof globalThis & { __ooviSetupSync?: { running?: Promise<SyncResult>; timer?: NodeJS.Timeout } };
export type SyncResult = { ok: boolean; restored: boolean; error?: string };

/** One sync. restored: this computer took a setup the account already had (a new computer). */
export function syncSetup(): Promise<SyncResult> {
  const s = (g.__ooviSetupSync ??= {});
  if (s.running) return s.running;
  s.running = run().finally(() => (s.running = undefined));
  return s.running;
}

async function run(): Promise<SyncResult> {
  if (!sessionToken()) return { ok: false, restored: false };
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await cloud<Remote>("/api/v1/setup", { auth: true });
      const state = readState();
      const remoteItems = remote.items ?? {};
      const first = !state;
      let local = collectSetup();
      const restored = first && !isEmptySetup(remoteItems);
      if (restored) local = dropUntouchedStarter(local);
      // A brand-new account that hasn't finished its first run yet: nothing to keep.
      if (isEmptySetup(remoteItems) && !fs.existsSync(onboardingFile()) && dropUntouchedStarter(local) !== local) return { ok: true, restored: false };
      const merged = uniqueBotNames(mergeSetup(local, remoteItems, state?.base ?? null), remoteItems);
      await applySetup(collectSetup(), merged);
      if (restored && !fs.existsSync(onboardingFile())) fs.writeFileSync(onboardingFile(), JSON.stringify({ restored: true, at: Date.now() }));
      let version = remote.version;
      if (itemHash(merged) !== itemHash(remoteItems)) {
        try {
          const r = await cloud<{ version: number }>("/api/v1/setup", { method: "PUT", auth: true, body: { baseVersion: remote.version, items: merged } });
          version = r.version;
        } catch (e) {
          if (e instanceof CloudError && e.status === 409) continue; // another computer saved first: merge again
          throw e;
        }
      }
      writeState({ version, base: baseOf(merged), at: Date.now() });
      return { ok: true, restored };
    }
    return { ok: false, restored: false, error: "busy" };
  } catch (e) {
    return { ok: false, restored: false, error: (e as Error).message };
  }
}

/** Every few minutes while oovi runs (and once soon after start). */
export function startSetupSync(): void {
  const s = (g.__ooviSetupSync ??= {});
  if (s.timer) return;
  setTimeout(() => void syncSetup(), 20_000).unref?.();
  s.timer = setInterval(() => void syncSetup(), 4 * 60_000);
  s.timer.unref?.();
}
