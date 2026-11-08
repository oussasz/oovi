// Skills: reusable step-by-step procedures, stored as SKILL.md files
// (name + description front matter, Markdown body), the same format used by
// Claude's Agent Skills and other agents, so skills can be downloaded and shared.
//
// Learning: oovi remembers recent commands. When the user asks for the same
// kind of task again and again, the bot is nudged to save a skill (the user
// approves it), and from then on the matching skill is loaded automatically.

import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./settings";

export type Skill = { slug: string; name: string; description: string; body: string; source?: string; uses: number; createdAt: number; updatedAt: number };
type Meta = Record<string, { uses: number; source?: string; createdAt: number; updatedAt: number; lastUsed?: number }>;

const dir = () => path.join(dataDir(), "skills");
const metaFile = () => path.join(dir(), "_meta.json");
const historyFile = () => path.join(dataDir(), "history.json");
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "skill";

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
}

export function parseSkill(md: string): { name?: string; description?: string; body: string } {
  const m = md.replace(/^﻿/, "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!m) return { body: md.trim() };
  const fm: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv?.[1]) fm[kv[1].toLowerCase()] = (kv[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return { name: fm.name, description: fm.description, body: (m[2] ?? "").trim() };
}

const toMd = (s: { name: string; description: string; body: string }) => `---\nname: ${s.name}\ndescription: ${s.description.replace(/\s+/g, " ")}\n---\n\n${s.body.trim()}\n`;

export function listSkills(): Skill[] {
  let slugs: string[] = [];
  try {
    slugs = fs.readdirSync(dir(), { withFileTypes: true }).filter((d) => d.isDirectory() && SLUG_RE.test(d.name)).map((d) => d.name);
  } catch {
    slugs = [];
  }
  const meta = readJson<Meta>(metaFile(), {});
  const out: Skill[] = [];
  for (const slug of slugs) {
    try {
      const p = parseSkill(fs.readFileSync(path.join(dir(), slug, "SKILL.md"), "utf8"));
      const m = meta[slug];
      out.push({ slug, name: p.name || slug, description: p.description || "", body: p.body, source: m?.source, uses: m?.uses ?? 0, createdAt: m?.createdAt ?? 0, updatedAt: m?.updatedAt ?? 0 });
    } catch {
      /* skip unreadable skill */
    }
  }
  return out.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

export function getSkill(slugOrName: string): Skill | undefined {
  const k = slugOrName.trim().toLowerCase();
  return listSkills().find((s) => s.slug === k || s.slug === slugify(k) || s.name.toLowerCase() === k);
}

export function saveSkill(input: { name: string; description: string; body: string; source?: string; slug?: string }): Skill {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  const description = input.description.trim().slice(0, 500);
  const body = input.body.trim().slice(0, 40_000);
  if (!name) throw new Error("A skill needs a name.");
  if (!description) throw new Error("A skill needs a description (when to use it).");
  if (!body) throw new Error("A skill needs instructions.");
  const slug = input.slug && SLUG_RE.test(input.slug) ? input.slug : slugify(name);
  fs.mkdirSync(path.join(dir(), slug), { recursive: true });
  fs.writeFileSync(path.join(dir(), slug, "SKILL.md"), toMd({ name, description, body }));
  const meta = readJson<Meta>(metaFile(), {});
  const now = Date.now();
  meta[slug] = { uses: meta[slug]?.uses ?? 0, source: input.source ?? meta[slug]?.source, createdAt: meta[slug]?.createdAt ?? now, updatedAt: now };
  writeJson(metaFile(), meta);
  const saved = getSkill(slug);
  if (!saved) throw new Error("Couldn't save the skill.");
  return saved;
}

export function deleteSkill(slug: string): void {
  if (!SLUG_RE.test(slug)) return;
  fs.rmSync(path.join(dir(), slug), { recursive: true, force: true });
  const meta = readJson<Meta>(metaFile(), {});
  delete meta[slug];
  writeJson(metaFile(), meta);
}

export function markUsed(slug: string): void {
  const meta = readJson<Meta>(metaFile(), {});
  const now = Date.now();
  meta[slug] = { ...(meta[slug] ?? { uses: 0, createdAt: now, updatedAt: now }), uses: (meta[slug]?.uses ?? 0) + 1, lastUsed: now };
  writeJson(metaFile(), meta);
}

/** Install a SKILL.md from a link (raw file, or a GitHub file/folder link). */
export async function importSkill(link: string): Promise<Skill> {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    throw new Error("That isn't a valid link.");
  }
  if (u.protocol !== "https:") throw new Error("Use an https:// link.");
  if (u.hostname === "github.com") {
    const p = u.pathname.split("/").filter(Boolean);
    if (p.length >= 5 && (p[2] === "blob" || p[2] === "tree")) {
      const [owner, repo, kind, branch, ...rest] = p;
      let file = rest.join("/");
      if (kind === "tree" || !/\.md$/i.test(file)) file = `${file.replace(/\/$/, "")}/SKILL.md`;
      u = new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`);
    }
  }
  const res = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { accept: "text/markdown, text/plain, */*" } });
  if (!res.ok) throw new Error(`Couldn't download it (${res.status}).`);
  const text = await res.text();
  if (text.length > 200_000) throw new Error("That file is too big to be a skill.");
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("That link is a web page. Use the raw SKILL.md file or a GitHub folder link.");
  const p = parseSkill(text);
  const folder = decodeURIComponent(u.pathname.split("/").filter(Boolean).slice(-2, -1)[0] ?? "imported-skill");
  return saveSkill({ name: p.name || folder, description: p.description || `Imported from ${u.hostname}`, body: p.body, source: link.trim() });
}

// ---------- matching & learning ----------

const STOP = new Set(
  "the and for with you your this that please can could would should make get show tell from about what how into are was were will have has had our out its also just them they then than there their".split(" "),
);

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/** Skills whose name/description share enough words with the request. */
export function relevantSkills(text: string, max = 2): Skill[] {
  const t = tokens(text);
  if (!t.size) return [];
  return listSkills()
    .map((s) => {
      const st = tokens(`${s.name} ${s.description}`);
      let hit = 0;
      for (const w of st) if (t.has(w)) hit++;
      return { s, score: hit / Math.max(3, Math.min(st.size, 8)) };
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.s);
}

/** Remember a user command; returns how many similar commands came before it. */
export function recordCommand(text: string): number {
  let history = readJson<string[]>(historyFile(), []);
  const t = tokens(text);
  let similar = 0;
  if (t.size >= 3) {
    for (const prev of history) {
      const p = tokens(prev);
      let inter = 0;
      for (const w of t) if (p.has(w)) inter++;
      if (inter / (t.size + p.size - inter) >= 0.5) similar++;
    }
  }
  history.push(text.slice(0, 500));
  if (history.length > 300) history = history.slice(-300);
  writeJson(historyFile(), history);
  return similar;
}
