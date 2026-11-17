// The Canvas: the chat's work files (tables and notes, lib/workfiles-core.ts) shown beside the chat as
// pages the user can read and edit while the bots fill them in, plus charts drawn from a table's columns
// and a short history of earlier versions. Pure (no imports with side effects): tests/unit/canvas.test.mts.

import type { ChartKind } from "./charts";
import type { WorkStore, WorkTable } from "./workfiles-core";

// Kept equal to lib/charts.ts and lib/workfiles-core.ts (checked in tests/unit/canvas.test.mts): this file
// has no imports that run, so tests load it as is.
export const CANVAS_CHART_KINDS: readonly ChartKind[] = ["column", "bar", "line", "pie", "doughnut", "area"];
export const CANVAS_PALETTE = ["4F6BED", "E07A3F", "2BB39A", "F2B134", "9B6BD6", "E05A7A", "5AA9E6", "7C8B9A", "C2185B", "558B2F", "6D4C41", "00838F"];
const CHART_KINDS = CANVAS_CHART_KINDS;
const PALETTE = CANVAS_PALETTE;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 40;
const MAX_CELL = 2_000;
/** Same rule as cleanFileName in lib/workfiles-core.ts. */
function cleanFileName(x: unknown): string {
  return String(x ?? "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 60);
}

/** A chart drawn from a table: x = the column of labels, y = the columns of numbers (one line/bar set each). */
export type CanvasChart = { table: string; type: ChartKind; x: string; y: string[]; title: string; updatedAt: number };
export const MAX_CHARTS = 20;
export const MAX_CHART_POINTS = 200;

/**
 * A number written the way people write them: "1 200,50", "1,200.50", "12 %", "$3.5k", "2M", "(40)".
 * null when the cell isn't a number.
 */
export function parseNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^[-−]/.test(s);
  s = s.replace(/^[(\-−+]+|\)$/g, "").replace(/[\s  '’]/g, "");
  const m = /^[^\d.,]*([\d.,]+)\s*([kKmMbB]|bn|md|mds|mio)?[^\d]*$/.exec(s);
  if (!m) return null;
  let num = m[1]!;
  const lastComma = num.lastIndexOf(",");
  const lastDot = num.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both: the later one is the decimal mark.
    num = lastComma > lastDot ? num.replace(/\./g, "").replace(",", ".") : num.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Only commas: "1,5" is a decimal; "1,200" or "1,200,000" are thousands.
    num = /^\d{1,3}(,\d{3})+$/.test(num) ? num.replace(/,/g, "") : num.replace(",", ".");
  } else if ((num.match(/\./g) ?? []).length > 1) num = num.replace(/\./g, "");
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const k = unit === "k" ? 1e3 : unit === "m" || unit === "mio" ? 1e6 : unit === "b" || unit === "bn" || unit === "md" || unit === "mds" ? 1e9 : 1;
  return (neg ? -1 : 1) * n * k;
}

const col = (t: WorkTable, name: string) => {
  const want = name.trim().toLowerCase();
  return t.columns.findIndex((c) => c.trim().toLowerCase() === want);
};

/** Columns that hold numbers in at least half of their filled cells (what a chart can plot). */
export function numericColumns(t: WorkTable): string[] {
  return t.columns.filter((_, i) => {
    let filled = 0;
    let nums = 0;
    for (const r of t.rows.slice(0, 500)) {
      const v = r[i];
      if (!v || !v.trim()) continue;
      filled++;
      if (parseNumber(v) !== null) nums++;
    }
    return filled > 0 && nums * 2 >= filled;
  });
}

/** Checks a chart request against its table. Returns the chart, or why it can't be drawn (for the bot or the user). */
export function makeChart(store: WorkStore, input: { table?: unknown; type?: unknown; x?: unknown; y?: unknown; title?: unknown }, now = Date.now()): { chart: CanvasChart; name: string } | string {
  const tableName = cleanFileName(input.table);
  const t = store.tables[tableName];
  if (!t) return `There is no table called "${tableName}".`;
  const type = (CHART_KINDS as readonly string[]).includes(String(input.type ?? "column")) ? (String(input.type ?? "column") as ChartKind) : null;
  if (!type) return `Chart type must be one of: ${CHART_KINDS.join(", ")}.`;
  const nums = numericColumns(t);
  const ys = (Array.isArray(input.y) ? input.y : input.y ? [input.y] : nums.slice(0, 1)).map((c) => String(c)).filter((c) => col(t, c) >= 0);
  if (!ys.length) return `Give y: the column(s) of numbers to plot. Columns with numbers in "${tableName}": ${nums.join(", ") || "none"}.`;
  const notNumbers = ys.filter((c) => !nums.some((n) => n.toLowerCase() === c.trim().toLowerCase()));
  if (notNumbers.length) return `These columns don't hold numbers: ${notNumbers.join(", ")}. Columns with numbers: ${nums.join(", ") || "none"}.`;
  const xIn = String(input.x ?? "");
  const x = col(t, xIn) >= 0 ? t.columns[col(t, xIn)]! : t.columns[0]!;
  const title = cleanFileName(input.title) || `${ys.join(", ")} by ${x}`.slice(0, 80);
  return { name: title, chart: { table: tableName, type, x, y: ys.slice(0, 6).map((c) => t.columns[col(t, c)]!), title, updatedAt: now } };
}

/** The numbers a chart shows now, read from its table (so it follows every edit). */
export function chartData(t: WorkTable | undefined, c: CanvasChart): { categories: string[]; series: { name: string; values: (number | null)[] }[]; colors: string[] } {
  if (!t) return { categories: [], series: [], colors: [] };
  const xi = col(t, c.x);
  const rows = t.rows.slice(0, MAX_CHART_POINTS);
  return {
    categories: rows.map((r, i) => (xi >= 0 ? r[xi] : "") || String(i + 1)),
    series: c.y.filter((y) => col(t, y) >= 0).map((y) => ({ name: y, values: rows.map((r) => parseNumber(r[col(t, y)])) })),
    colors: PALETTE.map((p) => `#${p}`),
  };
}

// ---------- edits made by hand ----------

const cellText = (v: unknown) => String(v ?? "").replace(/\r\n?/g, "\n").slice(0, MAX_CELL);

export type CanvasEdit =
  | { op: "cell"; table: string; row: number; col: number; value: string }
  | { op: "addRow"; table: string }
  | { op: "removeRow"; table: string; row: number }
  | { op: "addColumn"; table: string; name: string }
  | { op: "renameColumn"; table: string; col: number; name: string }
  | { op: "removeColumn"; table: string; col: number }
  | { op: "note"; name: string; text: string }
  | { op: "newNote"; name: string }
  | { op: "newTable"; name: string; columns: string[] }
  | { op: "rename"; kind: "table" | "note" | "chart"; name: string; to: string }
  | { op: "delete"; kind: "table" | "note" | "chart"; name: string }
  | { op: "chart"; table: string; type: string; x: string; y: string[]; title: string };

/** Applies one edit from the Canvas to the store. Returns null, or a short reason shown to the user. Rows and columns are 0-based. */
export function applyEdit(store: WorkStore, e: CanvasEdit, now = Date.now()): string | null {
  const table = (name: string) => store.tables[cleanFileName(name)];
  const charts = (store.charts ??= {});
  const taken = (name: string) => !!(store.tables[name] || store.notes[name] || charts[name]);
  switch (e.op) {
    case "cell": {
      const t = table(e.table);
      if (!t || !Number.isInteger(e.row) || !Number.isInteger(e.col) || e.row < 0 || e.row >= t.rows.length || e.col < 0 || e.col >= t.columns.length) return "That cell isn't there any more.";
      const row = t.rows[e.row]!;
      while (row.length < t.columns.length) row.push("");
      row[e.col] = cellText(e.value);
      t.updatedAt = now;
      return null;
    }
    case "addRow": {
      const t = table(e.table);
      if (!t) return "That table isn't there any more.";
      if (t.rows.length >= MAX_ROWS) return "This table is full.";
      t.rows.push(t.columns.map(() => ""));
      t.updatedAt = now;
      return null;
    }
    case "removeRow": {
      const t = table(e.table);
      if (!t || !Number.isInteger(e.row) || e.row < 0 || e.row >= t.rows.length) return "That row isn't there any more.";
      t.rows.splice(e.row, 1);
      t.updatedAt = now;
      return null;
    }
    case "addColumn": {
      const t = table(e.table);
      const name = cellText(e.name).replace(/\s+/g, " ").trim().slice(0, 60);
      if (!t) return "That table isn't there any more.";
      if (!name) return "Give the column a name.";
      if (t.columns.length >= MAX_COLUMNS) return "This table has the most columns it can hold.";
      if (col(t, name) >= 0) return "There is already a column with that name.";
      t.columns.push(name);
      for (const r of t.rows) r.push("");
      t.updatedAt = now;
      return null;
    }
    case "renameColumn": {
      const t = table(e.table);
      const name = cellText(e.name).replace(/\s+/g, " ").trim().slice(0, 60);
      if (!t || !Number.isInteger(e.col) || e.col < 0 || e.col >= t.columns.length) return "That column isn't there any more.";
      if (!name) return "Give the column a name.";
      if (col(t, name) >= 0 && col(t, name) !== e.col) return "There is already a column with that name.";
      const old = t.columns[e.col]!;
      t.columns[e.col] = name;
      // Charts that used the column follow its new name.
      for (const c of Object.values(charts)) {
        if (c.table !== cleanFileName(e.table)) continue;
        if (c.x === old) c.x = name;
        c.y = c.y.map((y) => (y === old ? name : y));
      }
      t.updatedAt = now;
      return null;
    }
    case "removeColumn": {
      const t = table(e.table);
      if (!t || !Number.isInteger(e.col) || e.col < 0 || e.col >= t.columns.length) return "That column isn't there any more.";
      if (t.columns.length <= 1) return "A table keeps at least one column.";
      t.columns.splice(e.col, 1);
      for (const r of t.rows) r.splice(e.col, 1);
      t.updatedAt = now;
      return null;
    }
    case "note": {
      const name = cleanFileName(e.name);
      if (!store.notes[name]) return "That page isn't there any more.";
      store.notes[name] = { text: String(e.text ?? "").slice(0, 2_000_000), updatedAt: now };
      return null;
    }
    case "newNote":
    case "newTable": {
      const name = cleanFileName(e.name);
      if (!name) return "Give it a name.";
      if (taken(name)) return "There is already a page with that name.";
      if (Object.keys(store.tables).length + Object.keys(store.notes).length >= 30) return "This chat has the most pages it can hold. Delete one first.";
      if (e.op === "newNote") store.notes[name] = { text: "", updatedAt: now };
      else {
        const columns = [...new Set((e.columns ?? []).map((c) => cellText(c).replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean))].slice(0, MAX_COLUMNS);
        store.tables[name] = { columns: columns.length ? columns : ["Name", "Notes"], rows: [], updatedAt: now };
      }
      return null;
    }
    case "rename": {
      const from = cleanFileName(e.name);
      const to = cleanFileName(e.to);
      const bag = e.kind === "table" ? store.tables : e.kind === "note" ? store.notes : charts;
      if (!bag[from]) return "That page isn't there any more.";
      if (!to) return "Give it a name.";
      if (to === from) return null;
      if (taken(to)) return "There is already a page with that name.";
      (bag as Record<string, unknown>)[to] = bag[from];
      delete bag[from];
      if (e.kind === "table") for (const c of Object.values(charts)) if (c.table === from) c.table = to;
      if (e.kind === "chart") charts[to]!.title = to;
      if (store.exports?.[from]) {
        store.exports[to] = store.exports[from]!;
        delete store.exports[from];
      }
      return null;
    }
    case "delete": {
      const name = cleanFileName(e.name);
      if (e.kind === "table") {
        delete store.tables[name];
        for (const [k, c] of Object.entries(charts)) if (c.table === name) delete charts[k];
      } else if (e.kind === "note") delete store.notes[name];
      else delete charts[name];
      return null;
    }
    case "chart": {
      if (Object.keys(charts).length >= MAX_CHARTS) return "This chat has the most charts it can hold. Delete one first.";
      const made = makeChart(store, e, now);
      if (typeof made === "string") return made;
      charts[made.name] = made.chart;
      return null;
    }
  }
}

// ---------- history: earlier versions of a page ----------

export type Snapshot = { id: string; at: number; kind: "table" | "note"; name: string; data: WorkTable | { text: string; updatedAt: number } };
/** A page changed again within this long keeps one earlier version (the one before the burst of edits). */
export const HISTORY_GAP_MS = 3 * 60_000;
export const HISTORY_PER_PAGE = 12;
export const HISTORY_TOTAL = 80;
/** Bigger pages aren't snapshotted (a 20,000-row table would fill the disk). */
export const HISTORY_MAX_CHARS = 400_000;

/**
 * The store is about to go from `before` to `after`: which earlier versions to keep. A page that changed (or
 * was deleted) gets its old content saved, unless one was saved for it in the last few minutes.
 */
export function snapshotsFor(history: Snapshot[], before: WorkStore, after: WorkStore, now = Date.now(), id: () => string = () => Math.random().toString(36).slice(2, 10)): Snapshot[] {
  const out = [...history];
  const consider = (kind: "table" | "note", name: string, old: WorkTable | { text: string; updatedAt: number }, cur: { updatedAt: number } | undefined) => {
    if (cur && cur.updatedAt === old.updatedAt) return;
    const empty = kind === "table" ? !(old as WorkTable).rows.length : !(old as { text: string }).text.trim();
    if (empty) return;
    const last = [...out].reverse().find((s) => s.kind === kind && s.name === name);
    if (last && now - last.at < HISTORY_GAP_MS) return;
    if (JSON.stringify(old).length > HISTORY_MAX_CHARS) return;
    out.push({ id: id(), at: now, kind, name, data: JSON.parse(JSON.stringify(old)) as Snapshot["data"] });
  };
  for (const [name, t] of Object.entries(before.tables)) consider("table", name, t, after.tables[name]);
  for (const [name, n] of Object.entries(before.notes)) consider("note", name, n, after.notes[name]);
  // Newest kept: a few per page, a cap in all.
  const perPage = new Map<string, number>();
  const kept: Snapshot[] = [];
  for (const s of [...out].reverse()) {
    const k = `${s.kind}:${s.name}`;
    const n = perPage.get(k) ?? 0;
    if (n >= HISTORY_PER_PAGE || kept.length >= HISTORY_TOTAL) continue;
    perPage.set(k, n + 1);
    kept.push(s);
  }
  return kept.reverse();
}

/** Puts an earlier version back (the current one is saved to history first, by the caller's save). */
export function restoreSnapshot(store: WorkStore, s: Snapshot, now = Date.now()): void {
  if (s.kind === "table") store.tables[s.name] = { ...(JSON.parse(JSON.stringify(s.data)) as WorkTable), updatedAt: now };
  else store.notes[s.name] = { text: (s.data as { text: string }).text, updatedAt: now };
}
