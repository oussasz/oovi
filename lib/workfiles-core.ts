// A team's shared work files: tables every bot adds rows to, and long notes.
// The chat stays short ("12 more added, 47 so far"); the work itself lives here and can be as long
// as the job needs. Rows that are the same thing (same name, or same phone number) are merged, so
// three bots filling one list never produce duplicates, and the count is always known.
// Pure (no imports): tests/unit/workfiles.test.mts.

export type WorkTable = { columns: string[]; rows: string[][]; updatedAt: number };
export type WorkStore = { tables: Record<string, WorkTable>; notes: Record<string, { text: string; updatedAt: number }> };

export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 40;
export const MAX_CELL = 2_000;
export const MAX_NOTE = 2_000_000; // characters: a very long report still fits
export const MAX_FILES = 30;

export const emptyStore = (): WorkStore => ({ tables: {}, notes: {} });

/** "Prospects Alger " -> "Prospects Alger" (a file name people can read; no path tricks). */
export function cleanFileName(x: unknown): string {
  return String(x ?? "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 60);
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return s.replace(/\s+/g, " ").trim().slice(0, MAX_CELL);
};
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
const PHONE_COL = /phone|t[ée]l|mobile|portable|gsm|whats ?app|num[ée]ro|number|هاتف|جوال|رقم/i;
/** Empty-looking values bots write when they found nothing. */
const BLANK = /^(?:-+|—|n\/?a|none|null|unknown|inconnu|aucun|vide|à vérifier|a verifier|to (?:verify|check|confirm)|tbd|\?+|غير معروف|لا يوجد)$/i;
export const isBlank = (v: string | undefined) => !v || !v.trim() || BLANK.test(v.trim());
const phoneKey = (v: string) => {
  const d = v.replace(/\D/g, "").replace(/^00/, "");
  return d.length >= 8 ? d.slice(-9) : "";
};

/** The column a header belongs to (case and accents ignored), or -1. */
export const columnIndex = (columns: string[], name: string) => {
  const n = norm(name);
  return n ? columns.findIndex((c) => norm(c) === n) : -1;
};

export type AddResult = { added: number; merged: number; skipped: number; total: number; error?: string };

/**
 * Add rows to a table (created on first use). A row is an array in column order, or an object keyed
 * by column name (new names become new columns). A row whose name (first column) or phone number is
 * already in the table isn't added again: its empty cells are filled from the new row instead.
 */
export function addRows(store: WorkStore, name: string, columnsIn: unknown, rowsIn: unknown, now = Date.now()): AddResult {
  const title = cleanFileName(name);
  if (!title) return { added: 0, merged: 0, skipped: 0, total: 0, error: "Give the table a name." };
  if (!Array.isArray(rowsIn) || !rowsIn.length) return { added: 0, merged: 0, skipped: 0, total: store.tables[title]?.rows.length ?? 0, error: "rows must be a list with at least one row." };
  let t = store.tables[title];
  if (!t) {
    const cols = (Array.isArray(columnsIn) ? columnsIn : []).map(cell).filter(Boolean);
    const first = rowsIn[0];
    const fromObject = first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first as object).map(cell).filter(Boolean) : [];
    const columns = [...new Set(cols.length ? cols : fromObject)].slice(0, MAX_COLUMNS);
    if (!columns.length) return { added: 0, merged: 0, skipped: 0, total: 0, error: "A new table needs `columns` (the header row), or rows written as objects." };
    if (Object.keys(store.tables).length + Object.keys(store.notes).length >= MAX_FILES) return { added: 0, merged: 0, skipped: 0, total: 0, error: `This chat already has ${MAX_FILES} work files. Reuse one of them.` };
    t = store.tables[title] = { columns, rows: [], updatedAt: now };
  }
  const table = t;
  const phoneCols = () => table.columns.map((c, i) => (PHONE_COL.test(c) ? i : -1)).filter((i) => i >= 0);
  const keysOf = (row: string[]) => {
    const keys: string[] = [];
    const n = norm(row[0] ?? "");
    if (n) keys.push(`n:${n}`);
    for (const i of phoneCols()) {
      const k = phoneKey(row[i] ?? "");
      if (k) keys.push(`p:${k}`);
    }
    return keys;
  };
  const index = new Map<string, number>();
  table.rows.forEach((r, i) => keysOf(r).forEach((k) => index.set(k, i)));

  let added = 0;
  let merged = 0;
  let skipped = 0;
  for (const raw of rowsIn.slice(0, 2_000)) {
    let row: string[];
    if (Array.isArray(raw)) row = raw.map(cell);
    else if (raw && typeof raw === "object") {
      row = [];
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        let i = columnIndex(table.columns, k);
        if (i < 0) {
          if (table.columns.length >= MAX_COLUMNS || !cell(k)) continue;
          table.columns.push(cell(k));
          i = table.columns.length - 1;
        }
        row[i] = cell(v);
      }
    } else {
      skipped++;
      continue;
    }
    row = Array.from({ length: table.columns.length }, (_, i) => row[i] ?? "");
    if (row.every((c) => isBlank(c)) || isBlank(row[0])) {
      skipped++;
      continue;
    }
    // The same phone number is the same business. The same name is too, unless both rows have
    // a phone number and they differ (two branches, or two shops that share a name).
    const keys = keysOf(row);
    const phones = keys.filter((k) => k.startsWith("p:"));
    let at = phones.map((k) => index.get(k)).find((i) => i !== undefined);
    if (at === undefined) {
      const byName = keys.filter((k) => k.startsWith("n:")).map((k) => index.get(k)).find((i) => i !== undefined);
      if (byName !== undefined && !(phones.length && keysOf(table.rows[byName]!).some((k) => k.startsWith("p:")))) at = byName;
    }
    if (at !== undefined) {
      // Already there: complete it instead of repeating it.
      const old = table.rows[at]!;
      let filled = false;
      row.forEach((c, i) => {
        if (!isBlank(c) && isBlank(old[i])) {
          old[i] = c;
          filled = true;
        }
      });
      while (old.length < table.columns.length) old.push("");
      keysOf(old).forEach((k) => index.set(k, at));
      if (filled) merged++;
      else skipped++;
      continue;
    }
    if (table.rows.length >= MAX_ROWS) {
      skipped++;
      continue;
    }
    table.rows.push(row);
    keysOf(row).forEach((k) => index.set(k, table.rows.length - 1));
    added++;
  }
  for (const r of table.rows) while (r.length < table.columns.length) r.push("");
  if (added || merged) table.updatedAt = now;
  return { added, merged, skipped, total: table.rows.length };
}

/** How many rows have a real value in each of these columns (all of them). */
export function countComplete(t: WorkTable | undefined, required: string[] = []): number {
  if (!t) return 0;
  const idx = required.map((c) => columnIndex(t.columns, c)).filter((i) => i >= 0);
  return t.rows.filter((r) => idx.every((i) => !isBlank(r[i]))).length;
}

/** "Prospects": 47 rows (Phone filled in 31, Source in 47). */
export function tableLine(name: string, t: WorkTable): string {
  const filled = t.columns
    .slice(1)
    .map((c, i) => ({ c, n: t.rows.filter((r) => !isBlank(r[i + 1])).length }))
    .filter((x) => x.n < t.rows.length)
    .slice(0, 6)
    .map((x) => `${x.c} filled in ${x.n}`);
  return `table "${name}": ${t.rows.length} rows, columns ${t.columns.join(" | ")}${filled.length ? ` (${filled.join(", ")})` : ""}`;
}

/** What the team has in its work files, for every bot's instructions. */
export function storeLines(store: WorkStore): string[] {
  const out: string[] = [];
  for (const [n, t] of Object.entries(store.tables)) out.push(`- ${tableLine(n, t)}`);
  for (const [n, x] of Object.entries(store.notes)) out.push(`- notes "${n}": ${x.text.length.toLocaleString("en-US")} characters`);
  return out;
}

/** Rows as text for a bot to read: "12. a | b | c". */
export function readRows(t: WorkTable, from = 1, limit = 100, onlyMissing?: string): { text: string; shown: number; matching: number } {
  const miss = onlyMissing ? columnIndex(t.columns, onlyMissing) : -1;
  const all = t.rows.map((r, i) => ({ r, n: i + 1 })).filter((x) => miss < 0 || isBlank(x.r[miss]));
  const start = Math.max(1, Math.floor(from) || 1);
  const part = all.filter((x) => x.n >= start).slice(0, Math.min(500, Math.max(1, Math.floor(limit) || 100)));
  return { text: [`# | ${t.columns.join(" | ")}`, ...part.map((x) => `${x.n}. ${x.r.map((c) => c.slice(0, 300)).join(" | ")}`)].join("\n"), shown: part.length, matching: all.length };
}

/** Change cells of one row (1-based), by column name. */
export function updateRow(t: WorkTable, rowNumber: number, values: unknown, now = Date.now()): string | null {
  const r = t.rows[Math.floor(rowNumber) - 1];
  if (!r) return `Row ${rowNumber} doesn't exist (the table has ${t.rows.length} rows).`;
  if (!values || typeof values !== "object" || Array.isArray(values)) return "values must be an object: {column name: new value}.";
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    const i = columnIndex(t.columns, k);
    if (i < 0) return `There is no column "${k}". Columns: ${t.columns.join(", ")}.`;
    r[i] = cell(v);
  }
  t.updatedAt = now;
  return null;
}

/** Remove rows by number (1-based). Returns how many were removed. */
export function removeRows(t: WorkTable, numbers: unknown, now = Date.now()): number {
  const set = new Set((Array.isArray(numbers) ? numbers : [numbers]).map((n) => Math.floor(Number(n))).filter((n) => n >= 1 && n <= t.rows.length));
  if (!set.size) return 0;
  t.rows = t.rows.filter((_, i) => !set.has(i + 1));
  t.updatedAt = now;
  return set.size;
}

/** Write or add to a notes file. */
export function writeNote(store: WorkStore, name: string, text: unknown, append: boolean, now = Date.now()): { size: number; error?: string } {
  const title = cleanFileName(name);
  if (!title) return { size: 0, error: "Give the notes file a name." };
  const add = typeof text === "string" ? text : "";
  if (!add.trim()) return { size: store.notes[title]?.text.length ?? 0, error: "text is empty." };
  const cur = store.notes[title];
  if (!cur && Object.keys(store.tables).length + Object.keys(store.notes).length >= MAX_FILES) return { size: 0, error: `This chat already has ${MAX_FILES} work files. Reuse one of them.` };
  const next = append && cur ? `${cur.text.replace(/\s+$/, "")}\n\n${add.trim()}` : add.trim();
  if (next.length > MAX_NOTE) return { size: cur?.text.length ?? 0, error: `That would make the file longer than ${MAX_NOTE.toLocaleString("en-US")} characters. Start a second notes file.` };
  store.notes[title] = { text: next, updatedAt: now };
  return { size: next.length };
}

/** A number that changes whenever the team's work grows: used to see whether a round made progress. */
export function progressMark(store: WorkStore): number {
  let n = 0;
  for (const t of Object.values(store.tables)) n += t.rows.length * 1000 + t.rows.reduce((a, r) => a + r.filter((c) => !isBlank(c)).length, 0);
  for (const x of Object.values(store.notes)) n += x.text.length;
  return n;
}

/** A table as Markdown (for a Word or PDF export). */
export function tableMarkdown(name: string, t: WorkTable): string {
  const esc = (c: string) => c.replace(/\|/g, "\\|");
  return [`# ${name}`, "", `| ${t.columns.map(esc).join(" | ")} |`, `| ${t.columns.map(() => "---").join(" | ")} |`, ...t.rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");
}
