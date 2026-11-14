// Builds lib/skills-library.json: the skills library offered in Marketplace > Skills > Library.
//
// Usage: node scripts/import-skills.mjs <dir-with-clones>
// The directory holds shallow clones named owner-repo (git clone --depth 1 https://github.com/owner/repo owner-repo).
// Only repositories with a license that allows reuse are read (listed in SOURCES), and every skill keeps
// its source, license and copyright line (shown in the app; the notices are in THIRD_PARTY_SKILLS.md).
//
// A skill is kept when it works as instructions alone: skills that run scripts bundled next to them
// can't work in oovi and are left out. Reference notes it points to (references/*.md) are added to its
// text. Anything that looks like instructions aimed at the model or a download-and-run command is
// left out too: this text goes into the bots' instructions.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SOURCES = [
  { dir: "anthropics-skills", repo: "anthropics/skills", license: "Apache-2.0" },
  { dir: "obra-superpowers", repo: "obra/superpowers", license: "MIT" },
  { dir: "coreyhaines31-marketingskills", repo: "coreyhaines31/marketingskills", license: "MIT" },
  { dir: "alirezarezvani-claude-skills", repo: "alirezarezvani/claude-skills", license: "MIT" },
  { dir: "wshobson-agents", repo: "wshobson/agents", license: "MIT" },
  { dir: "K-Dense-AI-claude-scientific-skills", repo: "K-Dense-AI/claude-scientific-skills", license: "MIT" },
];

const root = process.argv[2];
if (!root) throw new Error("Give the directory with the clones.");

const MAX = 40_000;
const RISKY = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts)/i,
  /disregard (the |your )?(system|previous) (prompt|instructions)/i,
  /curl [^\n|]*\|\s*(ba|z)?sh/i,
  /wget [^\n|]*\|\s*(ba|z)?sh/i,
  /iex\s*\(\s*(new-object|iwr|invoke-webrequest)/i,
  /\b(exfiltrat|keylog|reverse shell|steal (credentials|passwords|cookies))/i,
];

const words = (s) => s.toLowerCase();
function category(repo, rel, name, description) {
  if (repo.startsWith("K-Dense")) return "research";
  const t = words(`${rel} ${name} ${description}`);
  const n = words(`${name} ${description}`);
  if (/\b(code|coding|engineer\w*|develop\w*|devops|kubernetes|docker|terraform|apis?|frontend|backend|database|sql|pytest|unit tests?|debug\w*|python|javascript|typescript|react|rust|golang|java|cloud|aws|azure|gcp|git|github|ci\/cd|mcp|web app|microservices?|graphql|programming|software)\b/.test(n)) return "coding";
  if (/market|seo|content|copy|brand|social|newsletter|email|\bads?\b|campaign|writing|blog|launch|growth|\bcro\b|landing/.test(t)) return "writing";
  if (/research|science|scientif|paper|literature|statistic|analysis|analytics|data scien|experiment|survey/.test(t)) return "research";
  if (/\b(code|engineering|devops|security|ml|llm|infra\w*)\b/.test(t)) return "coding";
  if (/health|fitness|travel|cook|recipe|personal (life|finance|goals)|habit|family|wellness/.test(t)) return "life";
  return "work";
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fm = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1].toLowerCase();
      fm[key] = kv[2].replace(/^["'>|-]+\s*|["']$/g, "").trim();
    } else if (key && /^\s+\S/.test(line)) fm[key] = `${fm[key]} ${line.trim()}`.trim();
  }
  return { fm, body: m[2] };
}

const ACRONYMS = ["ai", "seo", "pdf", "api", "apis", "ui", "ux", "aws", "gcp", "sql", "ci", "cd", "crm", "kpi", "okr", "okrs", "saas", "b2b", "b2c", "gdpr", "hipaa", "iso", "eu", "llm", "rag", "ml", "qa", "hr", "cro", "ppc", "roi", "cfo", "ceo", "cto", "cmo", "coo", "cs", "gtm", "mvp", "prd", "rfp", "sla", "sop", "ab", "dns", "http", "jwt", "oauth", "rest", "sdk", "cli", "k8s", "csv", "ga4", "faq", "mcp", "aeo", "geo", "ppc", "ugc", "nps"];
const humanName = (s) => {
  const t = s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().split(" ").map((w) => (ACRONYMS.includes(w.toLowerCase()) ? w.toUpperCase() : w)).join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** Skills that only make sense inside a coding agent (Claude Code's files, commands and memory) or that speak for Anthropic. */
const AGENT_ONLY = /Use for \/[a-z]|\(\/[a-z-]+\)|\bLLM Wiki\b|wiki\/log|which [\w ]*skill fits|needs routing|skill (router|index)|\bhooks?\b.*\bsession\b|Claude Code|\.claude\/|CLAUDE\.md|slash command|\bUsage: \/|subagents?\b|auto-memory|\bvault\b|Anthropic('s)? (brand|academy|course)/i;
const SKIP_NAMES = new Set(["academy-guide", "brand-guidelines", "pdf", "slack-gif-creator", "algorithmic-art", "canvas-design", "theme-factory"]);
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

function copyrightOf(dir) {
  for (const f of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const line = fs.readFileSync(p, "utf8").split(/\r?\n/).find((l) => /copyright/i.test(l) && /\d{4}|\(c\)/i.test(l));
    if (line) return line.trim().slice(0, 160);
  }
  return "";
}

const out = [];
const seen = new Set();
const skipped = { scripts: 0, long: 0, short: 0, risky: 0, duplicate: 0, noLicense: 0, noFront: 0 };
const notices = [];
for (const src of SOURCES) {
  const base = path.join(root, src.dir);
  if (!fs.existsSync(base)) {
    console.warn(`missing clone: ${src.dir}`);
    continue;
  }
  const commit = execFileSync("git", ["-C", base, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const repoCopyright = copyrightOf(base);
  notices.push(`- ${src.repo} (${src.license}), commit ${commit.slice(0, 12)}${repoCopyright ? `: ${repoCopyright}` : ""}`);
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== ".git" && e.name !== "node_modules") stack.push(path.join(dir, e.name));
    }
    const file = path.join(dir, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const rel = path.relative(base, dir).split(path.sep).join("/");
    // A skill folder with its own license: only Apache or MIT ones are kept.
    const own = ["LICENSE", "LICENSE.txt", "LICENSE.md"].map((f) => path.join(dir, f)).find((p) => fs.existsSync(p));
    if (own && !/Apache License|MIT License|Permission is hereby granted/i.test(fs.readFileSync(own, "utf8").slice(0, 2000))) {
      skipped.noLicense++;
      continue;
    }
    if (src.repo === "anthropics/skills" && !own) {
      skipped.noLicense++;
      continue;
    }
    const parsed = frontmatter(fs.readFileSync(file, "utf8"));
    if (!parsed?.fm.name || !parsed.fm.description) {
      skipped.noFront++;
      continue;
    }
    let body = parsed.body.trim();
    if (/\bscripts\/[\w./-]+|\b[\w-]+\.py\b/.test(body) && fs.existsSync(path.join(dir, "scripts"))) {
      skipped.scripts++;
      continue;
    }
    for (const ref of [...new Set(body.match(/(?:references|resources|templates)\/[\w./-]+\.md/g) ?? [])].sort()) {
      const p = path.join(dir, ref);
      if (fs.existsSync(p)) body += `\n\n## ${ref}\n\n${fs.readFileSync(p, "utf8").trim()}`;
    }
    if (body.length > MAX) {
      skipped.long++;
      continue;
    }
    if (body.length < 300) {
      skipped.short++;
      continue;
    }
    if (SKIP_NAMES.has(parsed.fm.name.toLowerCase()) || AGENT_ONLY.test(parsed.fm.description) || (body.match(new RegExp(AGENT_ONLY.source, "gi")) ?? []).length > 2) {
      skipped.agentOnly = (skipped.agentOnly ?? 0) + 1;
      continue;
    }
    if (RISKY.some((r) => r.test(body) || r.test(parsed.fm.description))) {
      skipped.risky++;
      continue;
    }
    // "cs-aeo" style names (a persona prefix): the prefix says nothing to a user.
    const name = humanName(parsed.fm.name.replace(/^cs[-_]/i, "")).slice(0, 80);
    if (/ skills$/i.test(name)) {
      skipped.agentOnly = (skipped.agentOnly ?? 0) + 1;
      continue;
    }
    const key = slug(name);
    if (seen.has(key)) {
      skipped.duplicate++;
      continue;
    }
    seen.add(key);
    out.push({
      id: `lib-${key}`,
      name,
      description: parsed.fm.description.slice(0, 500),
      category: category(src.repo, rel, name, parsed.fm.description),
      body,
      source: { repo: src.repo, path: rel, license: src.license, url: `https://github.com/${src.repo}/tree/${commit}/${rel}`, copyright: repoCopyright },
    });
  }
}
out.sort((a, b) => a.name.localeCompare(b.name));
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
fs.writeFileSync(path.join(here, "..", "lib", "skills-library.json"), JSON.stringify(out));
fs.writeFileSync(
  path.join(here, "..", "THIRD_PARTY_SKILLS.md"),
  `# Third-party skills\n\nThe skills library (Marketplace > Skills > Library) contains skills from these repositories, under their licenses. Each skill shows its source in the app. Built by scripts/import-skills.mjs.\n\n${notices.join("\n")}\n\nMIT License: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.\n\nApache License 2.0: https://www.apache.org/licenses/LICENSE-2.0 (the skills from anthropics/skills are used unchanged, apart from adding their reference notes to the text).\n`,
);
const per = {};
for (const s of out) per[s.category] = (per[s.category] ?? 0) + 1;
console.log(`${out.length} skills`, per, "skipped", skipped, `${(JSON.stringify(out).length / 1e6).toFixed(2)} MB`);
