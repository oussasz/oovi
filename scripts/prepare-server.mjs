// After `next build`: turn .next/standalone into the server the desktop app ships
// (scripts/after-pack.cjs copies it to resources/server when electron-builder packages the app).
//
// - adds the browser files (.next/static) and public/, which standalone leaves out;
// - removes what must never ship (env files, a local data folder pulled in by file tracing);
// - removes what the running app never reads (source maps, TypeScript types, docs).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(out, "server.js"))) {
  console.error("No .next/standalone: run `next build` first (next.config.mjs output: 'standalone').");
  process.exit(1);
}

const copy = (from, to) => fs.cpSync(from, to, { recursive: true, force: true });
copy(path.join(root, ".next", "static"), path.join(out, ".next", "static"));
copy(path.join(root, "public"), path.join(out, "public"));

// Never ship secrets or local app data.
for (const name of fs.readdirSync(out)) {
  if (name.startsWith(".env") || name === "data" || name === "dist" || name === "web") {
    fs.rmSync(path.join(out, name), { recursive: true, force: true });
    console.log(`removed ${name}`);
  }
}

// Every library the server uses ships whole, with everything it depends on: the ones
// next.config.mjs keeps outside the bundle (serverExternalPackages) and every package file
// tracing found. Tracing alone keeps only the files it saw in use, and libraries load other
// files of their own later (another entry point, a .mjs next to the .js...). Next.js itself
// is the exception: its own trace is exact, and the whole package is over 100 MB.
const { default: nextConfig } = await import(new URL("../next.config.mjs", import.meta.url).href);
const traced = [];
const nm = path.join(out, "node_modules");
for (const e of fs.existsSync(nm) ? fs.readdirSync(nm) : []) {
  if (e.startsWith(".")) continue;
  if (e.startsWith("@")) for (const s of fs.readdirSync(path.join(nm, e))) traced.push(`${e}/${s}`);
  else traced.push(e);
}
const KEEP_TRACED = new Set(["next"]);
const pending = [...(nextConfig.serverExternalPackages ?? []), ...traced.filter((n) => !KEEP_TRACED.has(n))];
const shipped = new Set();
while (pending.length) {
  const name = pending.pop();
  if (shipped.has(name) || KEEP_TRACED.has(name) || /^(electron|@electron(-internal)?|typescript|@types)(\/|$)/.test(name) || name.startsWith("@next/swc")) continue;
  const from = path.join(root, "node_modules", name);
  const manifest = path.join(from, "package.json");
  if (!fs.existsSync(manifest)) continue; // an optional dependency not installed on this system
  shipped.add(name);
  copy(from, path.join(out, "node_modules", name));
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  pending.push(...Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }));
}
console.log(`shipped ${shipped.size} run-time libraries whole`);

// Packages file tracing pulls in through optional imports that the server never uses: the
// Electron runtime itself (the app already is Electron; Playwright only mentions it), and
// build-time tools.
const NEVER_AT_RUNTIME = ["electron", "@electron-internal", "@electron", "typescript", "@types", "@next/swc-win32-x64-msvc", "@next/swc-darwin-arm64", "@next/swc-darwin-x64", "@next/swc-linux-x64-gnu"];
for (const name of NEVER_AT_RUNTIME) {
  const p = path.join(out, "node_modules", name);
  if (fs.existsSync(p)) {
    const mb = size(p) / 1048576;
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`removed node_modules/${name} (${mb.toFixed(1)} MB)`);
  }
}

// Files the running app never reads.
const JUNK_FILE = /\.(map|d\.ts|d\.mts|d\.cts|md|markdown)$/i;
const JUNK_DIR = new Set(["__tests__", "test", "tests", "docs", "example", "examples", ".github"]);
let removed = 0;
let freed = 0;
function prune(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (JUNK_DIR.has(e.name)) {
        freed += size(p);
        fs.rmSync(p, { recursive: true, force: true });
        removed++;
      } else prune(p);
    } else if (JUNK_FILE.test(e.name) && !/^license/i.test(e.name)) {
      freed += fs.statSync(p).size;
      fs.rmSync(p, { force: true });
      removed++;
    }
  }
}
function size(p) {
  const s = fs.statSync(p);
  if (!s.isDirectory()) return s.size;
  return fs.readdirSync(p).reduce((t, n) => t + size(path.join(p, n)), 0);
}
function count(p) {
  const s = fs.statSync(p);
  if (!s.isDirectory()) return 1;
  return fs.readdirSync(p).reduce((t, n) => t + count(path.join(p, n)), 0);
}
prune(path.join(out, "node_modules"));

console.log(`pruned ${removed} files/folders (${(freed / 1048576).toFixed(1)} MB)`);
console.log(`server ready: ${(size(out) / 1048576).toFixed(1)} MB in ${count(out)} files at ${path.relative(root, out)}`);
