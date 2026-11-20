// Tables a bot works on without reading them. A workbook or a list of a thousand rows doesn't belong in a
// model's context: it costs a fortune, is cut to fit, and whatever the model retypes from memory can be wrong
// (an address that was never in the file). Here the rows stay data: the conversation gets a digest, a bot
// picks rows with filters, and an action that runs once per row is filled in from the row by the app.
// Pure (no files, no network): tests/unit/table-core.test.mts.

export type TableRow = { /** The row's number in the file (the header is row 1). */ n: number; cells: string[] };
export type Table = { columns: string[]; rows: TableRow[] };

export type FilterOp = "=" | "!=" | "contains" | "not_contains" | "empty" | "not_empty" | ">" | "<" | ">=" | "<=" | "in" | "not_in";
export type Filter = { column: string; op: FilterOp; value?: unknown };

const OPS: ReadonlySet<string> = new Set(["=", "!=", "contains", "not_contains", "empty", "not_empty", ">", "<", ">=", "<=", "in", "not_in"]);

/** One CSV record per line, quotes doubled inside quoted cells; a quoted cell may hold the separator and line breaks. */
export function parseCsv(text: string, sep = ","): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      any = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
      any = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (any || cell !== "") {
        row.push(cell);
        out.push(row);
      }
      row = [];
      cell = "";
      any = false;
    } else {
      cell += ch;
      any = true;
    }
  }
  if (any || cell !== "") {
    row.push(cell);
    out.push(row);
  }
  return out;
}

const trimRight = (cells: string[], width: number) => Array.from({ length: width }, (_, i) => (cells[i] ?? "").trim());

function tableOf(records: { n: number; cells: string[] }[]): Table {
  const head = records.find((r) => r.cells.some((c) => c.trim()));
  if (!head) return { columns: [], rows: [] };
  let width = head.cells.length;
  while (width > 0 && !head.cells[width - 1]?.trim()) width--;
  const columns = trimRight(head.cells, width).map((c, i) => c || `Column ${i + 1}`);
  const rows = records
    .filter((r) => r.n > head.n && r.cells.some((c) => c.trim()))
    .map((r) => ({ n: r.n, cells: trimRight(r.cells, width) }));
  return { columns, rows };
}

/** A sheet as lib/attachments.ts stores it: a first line of column letters, then "row number,cells…" in CSV. */
export function fromSheetText(text: string): Table {
  const records = parseCsv(text)
    .slice(1)
    .map((r) => ({ n: Number(r[0]), cells: r.slice(1) }))
    .filter((r) => Number.isFinite(r.n));
  return tableOf(records);
}

/** A CSV file's text: the separator is the one its first line uses most. */
export function fromCsvText(text: string): Table {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const sep = [",", ";", "\t", "|"].reduce((best, s) => (first.split(s).length > first.split(best).length ? s : best), ",");
  return tableOf(parseCsv(text.replace(/^﻿/, ""), sep).map((cells, i) => ({ n: i + 1, cells })));
}

/** Rows of a work table (lib/workfiles-core.ts): its rows are numbered from 1, the header is not a row. */
export function fromWorkTable(columns: string[], rows: string[][]): Table {
  return { columns, rows: rows.map((cells, i) => ({ n: i + 1, cells: trimRight(cells, columns.length) })) };
}

/** Names compared the way people write them: case, accents and spaces around don't matter. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function columnOf(t: Table, name: string): number {
  const want = fold(name);
  const exact = t.columns.findIndex((c) => c === name);
  return exact >= 0 ? exact : t.columns.findIndex((c) => fold(c) === want);
}

const noColumn = (t: Table, name: string) => `There is no column "${name}". The columns are: ${t.columns.join(", ")}.`;

/**
 * What the conversation carries instead of the table: its size, each column with how full it is (and its values
 * when there are only a few), and the first rows as an example. Everything else is read with filters.
 */
export function digest(t: Table, sample = 3): string {
  const total = t.rows.length;
  const lines = [`${total} rows, ${t.columns.length} columns.`, "Columns:"];
  t.columns.forEach((c, i) => {
    const counts = new Map<string, number>();
    let filled = 0;
    for (const r of t.rows) {
      const v = r.cells[i] ?? "";
      if (!v) continue;
      filled++;
      if (counts.size <= 12) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const few = counts.size > 0 && counts.size <= 8 && filled > counts.size;
    // A column with a handful of values (a status, a city) lists them; the others are shown by the sample rows.
    const values = few ? `; values: ${[...counts].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v.slice(0, 40)} (${n})`).join(", ")}` : "";
    lines.push(`- ${c}: ${filled} of ${total} filled${values}`);
  });
  for (const r of t.rows.slice(0, sample)) lines.push(`Row ${r.n}: ${t.columns.map((c, i) => `${c}=${(r.cells[i] ?? "").slice(0, 80) || "(empty)"}`).join(" · ")}`);
  return lines.join("\n");
}

/** The digest of a stored attachment that is a table (one per sheet), or null when the file isn't one. */
export function segmentsDigest(kind: string, segments: { label: string; text: string }[], sample = 3): string | null {
  const parts = segments.filter((s) => s.text.trim());
  if (kind === "csv") return parts[0] ? digest(fromCsvText(parts[0].text), sample) : null;
  if (kind !== "xlsx") return null;
  const sheets = parts.filter((s) => s.label.startsWith("Sheet"));
  if (!sheets.length) return null;
  return sheets.map((s) => (sheets.length > 1 ? `--- ${s.label} ---\n` : "") + digest(fromSheetText(s.text), sample)).join("\n");
}

const num = (s: string) => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** Filters as a bot sends them, checked: a list of {column, op, value}; every one must hold. */
export function cleanFilters(t: Table, raw: unknown): { filters: { col: number; op: FilterOp; value: unknown }[] } | { error: string } {
  if (raw === undefined || raw === null) return { filters: [] };
  const list = Array.isArray(raw) ? raw : [raw];
  const filters: { col: number; op: FilterOp; value: unknown }[] = [];
  for (const f of list) {
    if (!f || typeof f !== "object") return { error: 'Each filter is an object like {"column": "City", "op": "=", "value": "Alger"}.' };
    const { column, op, value } = f as { column?: unknown; op?: unknown; value?: unknown };
    const col = columnOf(t, String(column ?? ""));
    if (col < 0) return { error: noColumn(t, String(column ?? "")) };
    const o = String(op ?? "=").trim().toLowerCase().replace("==", "=").replace("<>", "!=");
    if (!OPS.has(o)) return { error: `Unknown filter op "${String(op)}". Use one of: ${[...OPS].join(", ")}.` };
    if ((o === "in" || o === "not_in") && !Array.isArray(value)) return { error: `"${o}" needs a list of values.` };
    filters.push({ col, op: o as FilterOp, value });
  }
  return { filters };
}

function holds(cell: string, op: FilterOp, value: unknown): boolean {
  const a = fold(cell);
  const b = fold(String(value ?? ""));
  switch (op) {
    case "=":
      return a === b;
    case "!=":
      return a !== b;
    case "contains":
      return a.includes(b);
    case "not_contains":
      return !a.includes(b);
    case "empty":
      return a === "";
    case "not_empty":
      return a !== "";
    case "in":
      return (value as unknown[]).some((v) => fold(String(v ?? "")) === a);
    case "not_in":
      return !(value as unknown[]).some((v) => fold(String(v ?? "")) === a);
    default: {
      const x = num(cell);
      const y = num(String(value ?? ""));
      if (x === null || y === null) return false;
      return op === ">" ? x > y : op === "<" ? x < y : op === ">=" ? x >= y : x <= y;
    }
  }
}

export type Selection = { columns: string[]; rows: TableRow[]; /** Rows that pass the filters, before `limit`. */ matching: number };

/** The rows that pass every filter, with only the columns asked for. */
export function selectRows(t: Table, o: { filter?: unknown; columns?: unknown; limit?: number; offset?: number } = {}): Selection | { error: string } {
  const f = cleanFilters(t, o.filter);
  if ("error" in f) return f;
  let cols = t.columns.map((_, i) => i);
  if (Array.isArray(o.columns) && o.columns.length) {
    cols = [];
    for (const c of o.columns) {
      const i = columnOf(t, String(c));
      if (i < 0) return { error: noColumn(t, String(c)) };
      if (!cols.includes(i)) cols.push(i);
    }
  }
  const pass = t.rows.filter((r) => f.filters.every((x) => holds(r.cells[x.col] ?? "", x.op, x.value)));
  const from = Math.max(0, Math.floor(o.offset ?? 0));
  const picked = o.limit === undefined ? pass.slice(from) : pass.slice(from, from + Math.max(0, Math.floor(o.limit)));
  return { columns: cols.map((i) => t.columns[i]!), rows: picked.map((r) => ({ n: r.n, cells: cols.map((i) => r.cells[i] ?? "") })), matching: pass.length };
}

/** Rows as compact text for a bot: "row | Col | Col", one row per line. */
export function cellsText(columns: string[], rows: TableRow[], maxCell = 300): string {
  const clean = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "/").slice(0, maxCell);
  return [`row | ${columns.join(" | ")}`, ...rows.map((r) => `${r.n} | ${r.cells.map(clean).join(" | ")}`)].join("\n");
}

const PLACEHOLDER = /\{([^{}\n]{1,80})\}/g;

/** Every {Column} named anywhere inside an action's input. */
export function placeholdersOf(input: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(PLACEHOLDER)) out.add(m[1]!.trim());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(input);
  return [...out];
}

function fill(input: unknown, value: (name: string) => string): unknown {
  if (typeof input === "string") return input.replace(PLACEHOLDER, (_, name: string) => value(name.trim()));
  if (Array.isArray(input)) return input.map((v) => fill(v, value));
  if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, fill(v, value)]));
  return input;
}

export type BatchPlan = {
  /** One action per row, its input filled in from that row. */
  items: { n: number; input: unknown }[];
  /** Rows left out: a value the action needs is empty, or the row repeats another's `uniqueBy` value. */
  skipped: { empty: number; duplicate: number };
  emptyRows: number[];
  /** The columns the input takes its values from. */
  uses: string[];
};

/**
 * The same action once per row. The input names columns as {Column}; the app fills them in from each row,
 * so a value that isn't in the table can't end up in an action. Rows where a named column is empty are
 * skipped (an email with no address, a greeting with no name), and so are repeats of `uniqueBy`.
 */
export function planBatch(t: Table, o: { input: unknown; filter?: unknown; uniqueBy?: string; limit?: number }): BatchPlan | { error: string } {
  const names = placeholdersOf(o.input);
  if (!names.length) return { error: `The input has no {Column} placeholder, so every row would get exactly the same action. Name the columns to fill in, e.g. {${t.columns[0] ?? "Email"}}. The columns are: ${t.columns.join(", ")}.` };
  const index = new Map<string, number>();
  for (const n of names) {
    const i = columnOf(t, n);
    if (i < 0) return { error: `The placeholder {${n}} names no column. The columns are: ${t.columns.join(", ")}.` };
    index.set(n, i);
  }
  let unique = -1;
  if (o.uniqueBy) {
    unique = columnOf(t, o.uniqueBy);
    if (unique < 0) return { error: noColumn(t, o.uniqueBy) };
  }
  const sel = selectRows(t, { filter: o.filter });
  if ("error" in sel) return sel;
  const byN = new Map(t.rows.map((r) => [r.n, r]));
  const items: BatchPlan["items"] = [];
  const emptyRows: number[] = [];
  const seen = new Set<string>();
  let duplicate = 0;
  for (const s of sel.rows) {
    const row = byN.get(s.n)!;
    if ([...index.values()].some((i) => !(row.cells[i] ?? "").trim())) {
      emptyRows.push(row.n);
      continue;
    }
    if (unique >= 0) {
      const key = fold(row.cells[unique] ?? "");
      if (key && seen.has(key)) {
        duplicate++;
        continue;
      }
      seen.add(key);
    }
    if (o.limit !== undefined && items.length >= o.limit) break;
    items.push({ n: row.n, input: fill(o.input, (name) => row.cells[index.get(name)!] ?? "") });
  }
  return { items, skipped: { empty: emptyRows.length, duplicate }, emptyRows, uses: [...index.keys()] };
}
