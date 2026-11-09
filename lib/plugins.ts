// Server side of the marketplace: install skills and plugins (bot teams),
// keep track of what was installed, and list Anthropic's public skills.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PLUGINS, SKILLS, type CatalogPlugin, type CatalogSkill } from "./catalog";
import { NAME_RE } from "./mentions";
import { dataDir } from "./settings";
import { listSkills, parseSkill, saveSkill, slugify } from "./skills";
import { createBot, createGroup, deleteBot, deleteChat, getChat, listBots, listChats } from "./store";
import { mainBot, pinMainBot, pinnedMainBot } from "./team";

type Installed = { id: string; botIds: string[]; groupId: string; at: number };
const file = () => path.join(dataDir(), "plugins.json");

export function installedPlugins(): Installed[] {
  try {
    const all = JSON.parse(fs.readFileSync(file(), "utf8")) as Installed[];
    const chats = new Set(listChats().map((c) => c.id));
    return all.filter((p) => chats.has(p.groupId));
  } catch {
    return [];
  }
}

/** Same, without reading every chat: checks only the teams' own groups (used in bot prompts). */
export function installedPluginsQuick(): Installed[] {
  try {
    const all = JSON.parse(fs.readFileSync(file(), "utf8")) as Installed[];
    return all.filter((p) => !!getChat(p.groupId));
  } catch {
    return [];
  }
}

function writeInstalled(list: Installed[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(list, null, 1));
}

/** Catalog skill ids already installed (matched by name). */
export function installedSkillIds(list: CatalogSkill[] = SKILLS): string[] {
  const have = new Set(listSkills().map((s) => slugify(s.name)));
  return list.filter((s) => have.has(slugify(s.name))).map((s) => s.id);
}

export function installSkill(id: string, list: CatalogSkill[] = SKILLS) {
  const s = list.find((x) => x.id === id);
  if (!s) throw new Error("Unknown skill.");
  return saveSkill({ name: s.name, description: s.description, body: s.body, source: "oovi" });
}

/** A free bot name: Dev, then Dev2, Dev3… */
function freeName(base: string, taken: Set<string>): string {
  const clean = base.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 20) || "Bot";
  let name = clean;
  for (let i = 2; taken.has(name.toLowerCase()) || !NAME_RE.test(name); i++) name = `${clean}${i}`;
  taken.add(name.toLowerCase());
  return name;
}

/** Create the team's bots, its group and its skills. */
export function installPlugin(id: string, list: CatalogPlugin[] = PLUGINS, skills: CatalogSkill[] = SKILLS): { groupId: string; bots: string[] } {
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error("Unknown plugin.");
  // Keep the user's main bot the main bot, even though this adds a new group leader.
  if (!pinnedMainBot()) {
    const main = mainBot();
    if (main) pinMainBot(main.id);
  }
  const taken = new Set(listBots().map((b) => b.name.toLowerCase()));
  const made = p.bots.map((b) => createBot({ name: freeName(b.name, taken), role: b.role, instructions: b.instructions, face: b.face, tools: { ...b.tools, mcp: [] } }));
  const lead = made[p.bots.findIndex((b) => b.lead)] ?? made[0];
  const group = createGroup({ name: p.group, memberIds: made.map((b) => b.id), leadId: lead?.id, orchestrate: true });
  const have = new Set(installedSkillIds(skills));
  for (const sid of p.skills) if (!have.has(sid) && skills.some((s) => s.id === sid)) installSkill(sid, skills);
  writeInstalled([...installedPlugins().filter((x) => x.id !== id), { id, botIds: made.map((b) => b.id), groupId: group.id, at: Date.now() }]);
  return { groupId: group.id, bots: made.map((b) => b.name) };
}

/** Remove a team: its bots and its group (skills stay). */
export function removePlugin(id: string): void {
  const all = installedPlugins();
  const p = all.find((x) => x.id === id);
  if (!p) return;
  for (const b of p.botIds) deleteBot(b);
  deleteChat(p.groupId);
  writeInstalled(all.filter((x) => x.id !== id));
}

// ---------- Node.js check (for connectors started with npx) ----------

let nodeOk: boolean | null = null;
export function hasNode(): boolean {
  if (nodeOk !== null) return nodeOk;
  try {
    const r = spawnSync("npx --version", { shell: true, timeout: 10_000, windowsHide: true, encoding: "utf8" });
    nodeOk = r.status === 0 && /\d+\.\d+/.test(r.stdout ?? "");
  } catch {
    nodeOk = false;
  }
  return nodeOk;
}

// ---------- Anthropic's public skills ----------

export type RemoteSkill = { id: string; name: string; description: string; url: string; by: string };
let remoteCache: { at: number; list: RemoteSkill[] } | null = null;

/**
 * Anthropic's public skills that work in oovi. Only skills made of a single
 * SKILL.md are listed: many others rely on scripts, templates or reference files
 * next to it (docx, pdf, pptx…), which oovi doesn't install, so they'd look
 * installed without really working.
 */
export async function anthropicSkills(): Promise<RemoteSkill[]> {
  if (remoteCache && Date.now() - remoteCache.at < 24 * 60 * 60 * 1000) return remoteCache.list;
  // One request for the whole repository tree (GitHub allows 60 an hour without a token).
  const r = await fetch("https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1", {
    headers: { accept: "application/vnd.github+json", "user-agent": "oovi-desktop" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const paths = ((await r.json()) as { tree?: { path: string; type: string }[] }).tree ?? [];
  const files = new Map<string, string[]>();
  for (const p of paths) {
    const m = p.path.match(/^skills\/([^/]+)\/(.+)$/);
    if (m?.[1] && m[2] && p.type === "blob") files.set(m[1], [...(files.get(m[1]) ?? []), m[2]]);
  }
  const complete = [...files.entries()].filter(([, f]) => f.includes("SKILL.md") && f.every((x) => x === "SKILL.md" || /^LICEN[CS]E/i.test(x))).map(([name]) => name);
  const list = await Promise.all(
    complete.map(async (name): Promise<RemoteSkill | null> => {
      try {
        const md = await fetch(`https://raw.githubusercontent.com/anthropics/skills/main/skills/${name}/SKILL.md`, { signal: AbortSignal.timeout(15_000) }).then((x) => (x.ok ? x.text() : ""));
        const p = parseSkill(md);
        return { id: name, name: p.name || name, description: (p.description || "").slice(0, 300), url: `https://github.com/anthropics/skills/tree/main/skills/${name}`, by: "Anthropic" };
      } catch {
        return null;
      }
    }),
  );
  remoteCache = { at: Date.now(), list: list.filter((x): x is RemoteSkill => !!x && !!x.description) };
  return remoteCache.list;
}
