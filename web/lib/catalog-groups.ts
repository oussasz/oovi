// How Admin > Marketplace groups its list: the same shelves people see in the app.
// Pure: tests/unit/web-catalog-sync.test.mts.

export type GroupRow = { id: string; kind: "connector" | "skill" | "plugin"; sort: number; data: Record<string, unknown> };
export type Group<T extends GroupRow> = { key: string; kind: T["kind"]; title: string; rows: T[] };

const CONNECTOR_TITLES: [string, string][] = [
  ["everything", "Connect any app"],
  ["google-microsoft", "Google & Microsoft"],
  ["productivity", "Productivity"],
  ["files", "Files"],
  ["design", "Design & sites"],
  ["sales", "Sales & support"],
  ["finance", "Finance"],
  ["dev", "Developers"],
  ["docs", "Docs & search"],
  ["local", "On this computer"],
];
const SKILL_TITLES: [string, string][] = [
  ["work", "Skills: work"],
  ["writing", "Skills: writing"],
  ["research", "Skills: research"],
  ["coding", "Skills: coding"],
  ["life", "Skills: life"],
];

const bySort = (a: GroupRow, b: GroupRow) => a.sort - b.sort || a.id.localeCompare(b.id);
const botCount = (r: GroupRow) => (Array.isArray(r.data.bots) ? r.data.bots.length : 0);

/** Experts (one bot), teams, connectors by category, skills by category. Empty groups are left out. */
export function groupCatalog<T extends GroupRow>(rows: T[]): Group<T>[] {
  const out: Group<T>[] = [];
  const add = (key: string, kind: T["kind"], title: string, list: T[]) => {
    if (list.length) out.push({ key, kind, title, rows: [...list].sort(bySort) });
  };
  const plugins = rows.filter((r) => r.kind === "plugin");
  add("experts", "plugin", "Experts", plugins.filter((r) => botCount(r) <= 1));
  add("teams", "plugin", "Teams", plugins.filter((r) => botCount(r) > 1));
  for (const [kind, titles, other] of [
    ["connector", CONNECTOR_TITLES, "Other connectors"],
    ["skill", SKILL_TITLES, "Other skills"],
  ] as const) {
    const list = rows.filter((r) => r.kind === kind);
    const known = new Set(titles.map(([c]) => c));
    for (const [cat, title] of titles) add(`${kind}-${cat}`, kind, title, list.filter((r) => r.data.category === cat));
    add(`${kind}-other`, kind, other, list.filter((r) => !known.has(String(r.data.category))));
  }
  return out;
}
