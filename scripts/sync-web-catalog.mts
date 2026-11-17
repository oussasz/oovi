// Writes web/lib/builtin-catalog.json: the Marketplace items built into the desktop app (lib/catalog.ts), in the
// shape the admin console stores them. The console (deployed from web/ alone, so it can't read lib/) uses this
// file to show every built-in item and to copy it into the database with one click, after which it is edited
// there like any other item. tests/unit/web-catalog-sync.test.mts fails when this file is out of date.
//
//   node scripts/sync-web-catalog.mts          (rewrite the file; run it after changing lib/catalog.ts)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONNECTORS, PLUGINS, SKILLS } from "../lib/catalog.ts";
import { builtinExpertPrompt } from "../lib/expert-prompts.ts";

export type SnapshotItem = { id: string; kind: "connector" | "skill" | "plugin"; sort: number; data: Record<string, unknown> };

export const SNAPSHOT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/lib/builtin-catalog.json");

/** The item without its id, with undefined fields dropped (what goes in the database's `data` column). */
const strip = ({ id, ...rest }: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(rest));

/** Same numbering as scripts/seed-catalog.mjs: 1000, 1010, 1020... within each kind, in the app's order. */
export function buildSnapshot(): SnapshotItem[] {
  const kinds: [SnapshotItem["kind"], unknown[]][] = [
    ["connector", CONNECTORS],
    ["skill", SKILLS],
    // A private expert's instructions live outside lib/catalog.ts (lib/expert-prompts.ts): the console gets them here.
    ["plugin", PLUGINS.map((p) => (p.protected ? { ...p, bots: p.bots.map((b, i) => ({ ...b, instructions: b.instructions || builtinExpertPrompt(p.id, i) })) } : p))],
  ];
  return kinds.flatMap(([kind, list]) =>
    (list as Record<string, unknown>[]).map((it, i) => ({ id: String(it.id), kind, sort: 1000 + i * 10, data: strip(it) })),
  );
}

export const renderSnapshot = (items: SnapshotItem[]): string => JSON.stringify(items, null, 1) + "\n";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const items = buildSnapshot();
  fs.writeFileSync(SNAPSHOT_FILE, renderSnapshot(items));
  console.log(`Wrote ${path.relative(process.cwd(), SNAPSHOT_FILE)}: ${items.length} items.`);
}
