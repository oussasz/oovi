// The rules of setup sync (lib/setup-sync.ts), pure so tests run them as is.
//
// A setup is a flat map of items: "bot:<id>", "group:<id>", "skill:<slug>", "routine:<id>", "lesson:<id>",
// "mcp:<name>", "memory:user|memory|knowledge", "settings", "main". Each PC remembers the hash of every
// item as it was at its last sync (the "base"). Merging the PC's items with the account's is then a
// three-way merge, item by item:
// - only one side changed it since the base: that side wins (an item missing on that side was deleted);
// - both changed it: an edit beats a deletion; two edits: this PC wins, except on its very first sync
//   (no base), where the account wins, because a new PC adopts the account's setup.
// Chats' messages are never part of a setup.

export type SetupItems = Record<string, unknown>;
export type SetupBase = Record<string, string>;

/** A short, stable fingerprint of an item (key order doesn't matter). */
export function itemHash(v: unknown): string {
  const s = stable(v);
  // FNV-1a, 2×32 bits: plenty to tell versions of one item apart.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function stable(v: unknown): string {
  if (v === undefined) return "u";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

export const baseOf = (items: SetupItems): SetupBase => Object.fromEntries(Object.entries(items).map(([k, v]) => [k, itemHash(v)]));

/** Merges this PC's items with the account's. base: null on this PC's first sync. */
export function mergeSetup(local: SetupItems, remote: SetupItems, base: SetupBase | null): SetupItems {
  const combine = (key: string, l: unknown, r: unknown): unknown =>
    // What the bots learned on two computers before they were synced: both are kept.
    key.startsWith("memory:") && typeof l === "string" && typeof r === "string" ? joinMemory(r, l) : r;
  const out: SetupItems = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[key];
    const r = remote[key];
    const lh = l === undefined ? undefined : itemHash(l);
    const rh = r === undefined ? undefined : itemHash(r);
    let v: unknown;
    if (lh === rh) v = l;
    else if (!base) v = r === undefined ? l : l === undefined ? r : combine(key, l, r);
    else {
      const b = base[key];
      const lChanged = lh !== b;
      const rChanged = rh !== b;
      if (lChanged && !rChanged) v = l;
      else if (!lChanged && rChanged) v = r;
      else v = l === undefined ? r : r === undefined ? l : l; // both changed: an edit beats a deletion; else this PC
    }
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Bot names must stay unique (they are @mentions): a bot that only this PC has gets a number added. */
export function uniqueBotNames(items: SetupItems, remote: SetupItems): SetupItems {
  const out = { ...items };
  const taken = new Set<string>();
  const keys = Object.keys(out).filter((k) => k.startsWith("bot:"));
  // The account's bots keep their names; this PC's own bots are renamed if needed.
  keys.sort((a, b) => Number(b in remote) - Number(a in remote));
  for (const k of keys) {
    const bot = out[k] as { name?: unknown };
    let name = typeof bot?.name === "string" ? bot.name : "";
    if (!name) continue;
    if (taken.has(name.toLowerCase())) {
      const stem = name.replace(/\d+$/, "").slice(0, 21) || "Bot";
      let n = 2;
      while (taken.has(`${stem}${n}`.toLowerCase())) n++;
      name = `${stem}${n}`;
      out[k] = { ...(bot as object), name };
    }
    taken.add(name.toLowerCase());
  }
  return out;
}

/** True when the setup has nothing of the user's yet (a brand-new account). */
export const isEmptySetup = (items: SetupItems) => !Object.keys(items).some((k) => k.startsWith("bot:"));

/** Two memory texts ("§"-separated entries) as one, each entry once, the account's first. */
export function joinMemory(a: string, b: string): string {
  const parts = (t: string) => t.split(/\r?\n§\r?\n/).map((e) => e.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...parts(a), ...parts(b)]) {
    const k = e.toLowerCase().replace(/\s+/g, " ");
    if (!seen.has(k)) (seen.add(k), out.push(e));
  }
  return out.join("\n§\n");
}
