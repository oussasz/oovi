// Copy the Marketplace items built into the desktop app (lib/catalog.ts) into
// the admin console's catalog_items table, so the console shows and manages
// everything the app shows. Safe to run again: items that already exist are
// left alone, so edits made in the console are never overwritten.
//
//   node --env-file=web/.env.local scripts/seed-catalog.mjs          (add missing items)
//   node --env-file=web/.env.local scripts/seed-catalog.mjs --dry    (only check them)

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.join(root, "package.json"));
const { createJiti } = req("jiti");
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const app = await jiti.import(path.join(root, "lib/catalog.ts"));
const site = await jiti.import(path.join(root, "web/lib/catalog.ts"));
const { Client } = createRequire(path.join(root, "web/package.json"))("pg");

const dry = process.argv.includes("--dry");
const strip = ({ id, ...rest }) => JSON.parse(JSON.stringify(rest)); // drop undefined fields
const items = [
  ...app.CONNECTORS.map((c, i) => ({ id: c.id, kind: "connector", sort: 1000 + i * 10, data: strip(c) })),
  ...app.SKILLS.map((s, i) => ({ id: s.id, kind: "skill", sort: 1000 + i * 10, data: strip(s) })),
  ...app.PLUGINS.map((p, i) => ({ id: p.id, kind: "plugin", sort: 1000 + i * 10, data: strip(p) })),
];

const bad = items.map((it) => ({ it, errors: site.validateCatalogData(it.kind, it.data) })).filter((x) => x.errors.length);
for (const { it, errors } of bad) console.log(`skip ${it.kind} ${it.id}: ${errors.join("; ")}`);
const good = items.filter((it) => !bad.some((b) => b.it === it));
console.log(`${good.length} of ${items.length} built-in items are valid.`);
if (dry) process.exit(bad.length ? 1 : 0);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (use --env-file=web/.env.local).");
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let added = 0;
for (const it of good) {
  const r = await db.query(
    `INSERT INTO catalog_items (id, kind, data, published, sort) VALUES ($1, $2, $3::jsonb, true, $4) ON CONFLICT (id) DO NOTHING`,
    [it.id, it.kind, JSON.stringify(it.data), it.sort],
  );
  added += r.rowCount ?? 0;
}
const { rows } = await db.query(`SELECT kind, count(*)::int AS n FROM catalog_items GROUP BY kind ORDER BY kind`);
console.log(`Added ${added} new items. In the console now: ${rows.map((r) => `${r.n} ${r.kind}s`).join(", ")}.`);
await db.end();
