// The team's shared work files, stored per chat, and the tools every bot gets for them
// (no role needed: a bot of any role, or none, can add to a table or write notes).
// work_export turns a table or notes into a real file (Excel, CSV, Word, PDF, Markdown) without the
// model retyping the rows, so a 500-row list costs the same to export as a 5-row one.

import fs from "node:fs";
import path from "node:path";
import { runDocTool, saveOutput } from "./files";
import type { ToolSpec } from "./llm";
import { dataDir, type BrowserConfig } from "./settings";
import type { ToolCall, ToolResult, Workspace } from "./types";
import { rowsForTable, type ListRow } from "./page-list-core";
import { dropUnseen, droppedNote, type Seen } from "./workfiles-core";
import { makeChart, MAX_CHARTS, snapshotsFor, type Snapshot } from "./canvas-core";
import { addRows, cleanFileName, emptyStore, exportView, filledCounts, readRows, removeRows, setColumns, storeLines, tableLine, tableMarkdown, updateRow, writeNote, type WorkStore } from "./workfiles-core";

const ID_RE = /^[\w-]{1,64}$/;
const file = (chatId: string) => path.join(dataDir(), "work", `${chatId}.json`);

export function loadWork(chatId: string): WorkStore {
  if (!ID_RE.test(chatId)) return emptyStore();
  try {
    const j = JSON.parse(fs.readFileSync(file(chatId), "utf8")) as Partial<WorkStore>;
    return {
      tables: j.tables && typeof j.tables === "object" ? j.tables : {},
      notes: j.notes && typeof j.notes === "object" ? j.notes : {},
      ...(j.exports && typeof j.exports === "object" ? { exports: j.exports } : {}),
      ...(j.charts && typeof j.charts === "object" ? { charts: j.charts } : {}),
    };
  } catch {
    return emptyStore();
  }
}

const historyFile = (chatId: string) => path.join(dataDir(), "work", `${chatId}.history.json`);

/** Earlier versions of this chat's pages, oldest first (lib/canvas-core.ts). */
export function loadHistory(chatId: string): Snapshot[] {
  if (!ID_RE.test(chatId)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(historyFile(chatId), "utf8")) as unknown;
    return Array.isArray(j) ? (j as Snapshot[]).filter((s) => s && typeof s.id === "string" && (s.kind === "table" || s.kind === "note") && s.data) : [];
  } catch {
    return [];
  }
}

export function saveWork(chatId: string, store: WorkStore) {
  if (!ID_RE.test(chatId)) return;
  const f = file(chatId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // What a page was before this change is kept for the Canvas's history (never fails the save).
  try {
    const before = loadWork(chatId);
    const had = loadHistory(chatId);
    const next = snapshotsFor(had, before, store);
    if (next.length !== had.length || next.at(-1)?.id !== had.at(-1)?.id) fs.writeFileSync(historyFile(chatId), JSON.stringify(next));
  } catch {
    /* history is a bonus */
  }
  // Write then rename: a crash mid-write never leaves half a file of the team's work.
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, f);
}

/** The chat was deleted: its work files go with it. */
export function deleteWork(chatId: string) {
  if (!ID_RE.test(chatId)) return;
  fs.rmSync(file(chatId), { force: true });
  fs.rmSync(historyFile(chatId), { force: true });
}

export const WORK_SPECS: ToolSpec[] = [
  {
    name: "work_table",
    description:
      "The team's shared tables for this chat: every bot adds its rows to the same table, so results add up instead of living in chat messages. Use it for any list you build (prospects, contacts, products, sources, tasks). add: append rows (the table is created on first use with `columns`); a row whose name (first column) or phone number is already there is completed, never repeated. read: see rows (use `missing` to list only rows where a column is still empty); a long table comes in parts: act on each part (update, check) before reading the next, because older reads are shortened to save space. replace: new rows in place of all rows. update: change cells of one row (a column that isn't there yet, such as Status, is added). remove: delete rows by number. columns: reorder, rename, empty (clear) or drop columns of the whole table at once, without retyping rows (order lists the columns in their new order; a column left out is removed, a new name is added empty). chart: draw a chart from the table's number columns (it follows the table's numbers). Add rows as you find them, in batches, rather than all at the end. Never rebuild or retype a table from memory: change it with update/columns and deliver it with work_export. The user sees these tables, notes and charts live in the Canvas beside the chat and can edit them by hand: read again before changing rows they may have edited.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "replace", "read", "update", "remove", "columns", "chart"] },
        table: { type: "string", description: "Table name, e.g. 'Prospects Alger'. Use the existing one when the team already has it." },
        columns: { type: "array", items: { type: "string" }, description: "add (new table only) or replace: the header row. Put the name first; include a Source column for where each row was found." },
        rows: { type: "array", items: {}, description: "add or replace: rows as arrays in column order, or objects keyed by column name. Leave a cell empty when you don't have the value; never invent one." },
        row: { type: "integer", description: "update: the row number" },
        values: { type: "object", description: "update: {column name: new value}. A new column name adds that column." },
        rows_to_remove: { type: "array", items: { type: "integer" }, description: "remove: row numbers" },
        from: { type: "integer", description: "read: first row number (default 1)" },
        limit: { type: "integer", description: "read: how many rows (default 100, max 500)" },
        missing: { type: "string", description: "read: only rows where this column is empty" },
        order: { type: "array", items: { type: "string" }, description: "columns: the new column order, e.g. ['Statut','Note','Name','Phone',…]" },
        rename: { type: "object", description: "columns: {old name: new name}" },
        clear: { type: "array", items: { type: "string" }, description: "columns: columns to empty in every row" },
        chart_type: { type: "string", enum: ["column", "bar", "line", "area", "pie", "doughnut"], description: "chart: default column" },
        x: { type: "string", description: "chart: the column of labels (default: the first column)" },
        y: { type: "array", items: { type: "string" }, description: "chart: the column(s) of numbers to plot" },
        title: { type: "string", description: "chart: its title" },
      },
      required: ["action", "table"],
    },
  },
  {
    name: "work_notes",
    description:
      "The team's shared notes files for this chat: long text that doesn't belong in a chat message (findings, a draft, a detailed report, a review with corrections). The file itself has room for as much as the work needs, in Markdown, but one call can only carry so much: write a long text in parts (write with the first sections, then append a few sections per call). append adds to the end, write replaces the file, read returns it. Your chat message stays short and names the file.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["append", "write", "read"] },
        file: { type: "string", description: "Notes name, e.g. 'Market study'" },
        text: { type: "string", description: "append/write: the text (Markdown)" },
        from: { type: "integer", description: "read: first character (default 0)" },
        max_chars: { type: "integer", description: "read: default 20000, max 60000" },
      },
      required: ["action", "file"],
    },
  },
  {
    name: "work_export",
    description:
      "Turn a work table or notes file into a real file for the user, complete, without retyping it: a table becomes Excel (.xlsx) or CSV; notes become Word (.docx), PDF or Markdown; a table can also go into a Word or PDF document. Use this (not create_spreadsheet or create_document) to deliver what's in a work file. Exporting the same work file again updates the same file the user already has (one deliverable, one file, always the latest): don't invent new names like _FINAL, _v2 or _UPDATED. Only when the user asks for a separate copy, set new_copy. For a file with other columns than the table (blank tracking columns first, some columns left out), use columns and empty_columns: the table itself stays as it is. The result gives the exact filled counts per column: report those numbers, never estimates.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The table's or notes file's name" },
        format: { type: "string", enum: ["xlsx", "csv", "docx", "pdf", "md"] },
        filename: { type: "string", description: "Optional file name, only for the first export (later exports keep the same file)" },
        columns: { type: "array", items: { type: "string" }, description: "Spreadsheet only: the columns of the file, in order (default: all the table's columns). A name not in the table becomes an empty column." },
        empty_columns: { type: "array", items: { type: "string" }, description: "Spreadsheet only: columns to put in the file empty (e.g. Statut, Note for the user's own tracking)" },
        new_copy: { type: "boolean", description: "Only when the user asked for a separate copy: make a new file instead of updating the existing one" },
      },
      required: ["name", "format"],
    },
  },
];

/** Rows pulled from a web page (extract_list) go into a work table, in the columns the table already has. */
export function addListRows(chatId: string, wanted: string, rows: ListRow[], source: string): { text: string; isError?: boolean } {
  return addRecordRows(chatId, wanted, (columns) => rowsForTable(columns, rows, source));
}

/**
 * Records a tool collected (places, publications, a page's list) go into a work table without passing
 * through the model: rows as objects keyed by column name, or built from the table's present columns.
 */
export function addRecordRows(chatId: string, wanted: string, records: Record<string, string>[] | ((columns: string[] | undefined) => Record<string, string>[])): { text: string; isError?: boolean } {
  if (!ID_RE.test(chatId)) return { text: "This chat has no work files.", isError: true };
  const store = loadWork(chatId);
  const name = nameOf(store, wanted, "tables") ?? cleanFileName(wanted);
  const r = addRows(store, name, undefined, typeof records === "function" ? records(store.tables[name]?.columns) : records);
  if (r.error) return { text: r.error, isError: true };
  saveWork(chatId, store);
  const parts = [`${r.added} added`, r.merged ? `${r.merged} already there and completed` : "", r.skipped ? `${r.skipped} skipped (already there with nothing new)` : ""].filter(Boolean);
  return { text: `${parts.join(", ")}. Now: ${tableLine(name, store.tables[name]!)}.` };
}

export const WORK_TOOLS: ReadonlySet<string> = new Set(WORK_SPECS.map((s) => s.name));

/** For every bot's instructions: what the team already has. */
export function workPrompt(_chatId: string, group: boolean, fromMain = false): string[] {
  return [
    "",
    `Work files${fromMain ? " (the same ones as the main assistant who gave this task: what it already found is in them, and what you add it sees at once; add to its table, don't start another)" : group ? " (shared by the whole team in this chat)" : ""}: work_table for lists and work_notes for long text. Anything long (a list, findings, a draft, a detailed report) goes into a work file, not into the chat: the chat message stays short and says what you added and where.`,
    "The Canvas: every work_table and work_notes page shows in the Canvas beside the chat, opened at that page as you write it. The user may call it the Canvas, \"كانفاس\", \"الكانفا\" or even \"Canva\": that is this Canvas, not the Canva design site (canva.com) unless they name the site or ask for a Canva design. Tables, plans, drafts and reports go in the Canvas FIRST. Make a file (work_export, create_document, create_spreadsheet, create_presentation) only when the user asks for a file, a download, an attachment or to send it; then make the one format they asked for (a table can go in a Word document when they want a document), never the same thing twice in two formats. When they ask about a page, read it again with work_table read or work_notes read (the pages are listed with their message) before answering or changing it.",
    "Sources for a list: a row needs a source, not a perfect one. A detail you read on any page (a directory, a listing, a map's results, a search result) goes into the table, with that page in the Source column; when you couldn't also see it on the item's own page, write \"to confirm\" in a Status column. Don't hold a found row back while you look for a better source, and never ask the user to copy from a page what a page shows. Only what you read nowhere stays empty. If the user asked for stricter proof, follow the user.",
    "One deliverable, one file: when you change something you already delivered (a list, a report), deliver it again under the same file name (work_export again, or the same filename): the user's file is updated, not copied. Never make copies named FINAL, v2, UPDATED, CORRECT or similar unless the user asks for a separate copy, and never rebuild a list by retyping it.",
  ];
}

/** What the work files hold right now (changes as rows are added): told with the user's message, not in the instructions. */
export function workNow(chatId: string): string[] {
  const lines = storeLines(loadWork(chatId));
  return lines.length ? ["The work files right now:", ...lines] : [];
}

/** Text from the web must stay text in Excel: a cell starting with "=" would run as a formula. */
const asText = (c: string) => (/^[=@]/.test(c) ? ` ${c}` : c);

/** Word and PDF have a size limit; Markdown takes any length. */
async function asDocument(call: ToolCall, filename: string, content: string, ws: Workspace | undefined, browser: BrowserConfig, chatId?: string): Promise<ToolResult> {
  if (filename.endsWith(".md")) return { ...saveOutput(call, filename, ws, Buffer.from(content, "utf8"), "a document", chatId), name: call.name };
  if (content.length > 380_000) return { id: call.id, name: call.name, content: `That's too long for one ${filename.endsWith(".pdf") ? "PDF" : "Word"} file (${content.length.toLocaleString("en-US")} characters). Export it as md (any length), or split it into several notes files and export each.`, isError: true };
  const r = await runDocTool({ id: call.id, name: "create_document", input: { filename, content } }, ws, browser, chatId);
  return { ...r, name: call.name };
}

/** A value a model sent as JSON text where a list or an object was expected. */
const fromText = (v: unknown): unknown => {
  if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

const loose = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const nameOf = (store: WorkStore, wanted: string, kind: "tables" | "notes"): string | null => {
  const clean = cleanFileName(wanted);
  if (store[kind][clean]) return clean;
  const keys = Object.keys(store[kind]);
  const lower = clean.toLowerCase();
  const same = keys.find((k) => k.toLowerCase() === lower) ?? keys.find((k) => loose(k) === loose(clean));
  if (same || loose(clean).length < 4) return same ?? null;
  // A name given from memory ("Market study" for "Market study 2026"): accepted when exactly one file fits.
  const near = keys.filter((k) => loose(k).includes(loose(clean)) || loose(clean).includes(loose(k)));
  if (near.length === 1) return near[0]!;
  // Words in another order or with one word different ("Notes marché Alger" for "Alger notes de marché"):
  // the one file that shares clearly the most words, when it shares at least two thirds of them.
  const words = (x: string) => new Set(x.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
  const want = words(clean);
  if (want.size < 2) return null;
  const scored = keys.map((k) => {
    const have = words(k);
    const shared = [...want].filter((w) => have.has(w)).length;
    return { k, score: shared / Math.max(want.size, have.size) };
  }).sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  return best && best.score >= 2 / 3 && (!next || next.score < best.score) ? best.k : null;
};

/** seen: what the team has read in this chat; contact details found nowhere in it are not saved (null: can't be checked, e.g. after reading images). */
export async function runWorkTool(call: ToolCall, chatId: string, ws: Workspace | undefined, browser: BrowserConfig, seen: Seen | null = null): Promise<ToolResult> {
  const ok = (content: string): ToolResult => ({ id: call.id, name: call.name, content });
  const bad = (content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });
  const i = call.input;
  const store = loadWork(chatId);
  const others = () => {
    const l = storeLines(store);
    return l.length ? ` The work files here: ${l.map((x) => x.slice(2)).join("; ")}.` : " There are no work files in this chat yet.";
  };
  try {
    if (call.name === "work_table") {
      const wanted = String(i.table ?? "");
      const existing = nameOf(store, wanted, "tables");
      if (i.action === "replace" && existing) {
        // Everything the table held is swapped for the new rows (the previous version stays in the Canvas history).
        const given = fromText(i.rows);
        if (!Array.isArray(given) || !given.length) return bad("rows must be a list with at least one row (the new content of the table).");
        const t = store.tables[existing]!;
        const newCols = (Array.isArray(fromText(i.columns)) ? (fromText(i.columns) as unknown[]) : []).map((c) => String(c ?? "").trim()).filter(Boolean);
        const was = t.rows.length;
        const checked = seen ? dropUnseen(newCols.length ? newCols : t.columns, given, seen) : { rows: given, dropped: [] };
        const backup = { columns: t.columns, rows: t.rows };
        if (newCols.length) t.columns = [...new Set(newCols)];
        t.rows = [];
        const r = addRows(store, existing, null, checked.rows);
        if (r.error || !r.added) {
          t.columns = backup.columns;
          t.rows = backup.rows;
          return bad(r.error ?? "None of the new rows could be used: nothing was changed.");
        }
        saveWork(chatId, store);
        return ok([`Replaced: the ${was} old rows are gone, ${r.added} new rows are in. Now: ${tableLine(existing, store.tables[existing]!)}. The user sees it in the Canvas (the old version is in its history).`, droppedNote(checked.dropped)].filter(Boolean).join("\n"));
      }
      if (i.action === "add" || i.action === "replace") {
        // Models sometimes send the rows as text (a JSON string) instead of a list: read it as the list it is.
        const given = fromText(i.rows);
        const cols = existing ? store.tables[existing]!.columns : (Array.isArray(fromText(i.columns)) ? (fromText(i.columns) as unknown[]) : []).map(String);
        const checked = seen ? dropUnseen(cols, given, seen) : { rows: given, dropped: [] };
        const r = addRows(store, existing ?? wanted, fromText(i.columns), checked.rows);
        if (r.error) return bad(r.error);
        saveWork(chatId, store);
        const name = existing ?? cleanFileName(wanted);
        const parts = [`${r.added} added`, r.merged ? `${r.merged} already there and completed` : "", r.skipped ? `${r.skipped} skipped (already there with nothing new, or empty)` : ""].filter(Boolean);
        return ok([`${parts.join(", ")}. Now: ${tableLine(name, store.tables[name]!)}.`, droppedNote(checked.dropped)].filter(Boolean).join("\n"));
      }
      if (!existing) return bad(`There is no table "${cleanFileName(wanted)}".${others()}`);
      const t = store.tables[existing]!;
      if (i.action === "read") {
        const r = readRows(t, Number(i.from) || 1, Number(i.limit) || 100, typeof i.missing === "string" ? i.missing : undefined);
        const more = r.next ? `\n[More rows from row ${r.next}. Do what you need with these rows first (update, check), then read again with from=${r.next}: older reads are shortened to save space, so never rely on remembering them.]` : "";
        return ok(`${tableLine(existing, t)}\n${typeof i.missing === "string" ? `${r.matching} rows have no ${i.missing}. ` : ""}Showing ${r.shown}:\n${r.text}${more}`);
      }
      if (i.action === "update") {
        const values = fromText(i.values);
        const checked = seen && values && typeof values === "object" && !Array.isArray(values) ? dropUnseen(t.columns, [{ [t.columns[0] ?? "Name"]: t.rows[Math.floor(Number(i.row)) - 1]?.[0] ?? "", ...(values as object) }], seen) : null;
        const safe = checked ? Object.fromEntries(Object.entries((checked.rows as Record<string, unknown>[])[0]!).filter(([k]) => k in (values as object))) : values;
        const before = t.columns.length;
        const err = updateRow(t, Number(i.row), safe);
        if (err) return bad(err);
        saveWork(chatId, store);
        const added = t.columns.slice(before);
        return ok([`Row ${Math.floor(Number(i.row))} updated.${added.length ? ` New column${added.length > 1 ? "s" : ""} ${added.map((c) => `"${c}"`).join(", ")} added to the table (empty in the other rows).` : ""}`, droppedNote(checked?.dropped ?? [])].filter(Boolean).join("\n"));
      }
      if (i.action === "columns") {
        const err = setColumns(t, { order: fromText(i.order), rename: fromText(i.rename), clear: fromText(i.clear) });
        if (err) return bad(err);
        saveWork(chatId, store);
        return ok(`Done. Now: ${tableLine(existing, t)}.`);
      }
      if (i.action === "remove") {
        const n = removeRows(t, i.rows_to_remove);
        if (!n) return bad("No such rows. Give rows_to_remove as row numbers from work_table read.");
        saveWork(chatId, store);
        return ok(`${n} rows removed. Now: ${tableLine(existing, t)}. (Row numbers changed: read again before more changes.)`);
      }
      if (i.action === "chart") {
        const charts = (store.charts ??= {});
        const made = makeChart(store, { table: existing, type: i.chart_type, x: i.x, y: fromText(i.y), title: i.title });
        if (typeof made === "string") return bad(made);
        if (!charts[made.name] && Object.keys(charts).length >= MAX_CHARTS) return bad("This chat already has the most charts it can hold. Reuse a chart's title to replace it.");
        charts[made.name] = made.chart;
        saveWork(chatId, store);
        return ok(`Chart "${made.name}" (${made.chart.type}: ${made.chart.y.join(", ")} by ${made.chart.x}) is in the user's Canvas. It follows the table: when the numbers change, so does the chart.`);
      }
      return bad("action must be add, replace, read, update, remove, columns or chart.");
    }

    if (call.name === "work_notes") {
      const wanted = String(i.file ?? "");
      const existing = nameOf(store, wanted, "notes");
      if (i.action === "read") {
        if (!existing) return bad(`There is no notes file "${cleanFileName(wanted)}".${others()}`);
        const text = store.notes[existing]!.text;
        const from = Math.max(0, Math.floor(Number(i.from) || 0));
        const max = Math.min(60_000, Math.max(1_000, Math.floor(Number(i.max_chars) || 20_000)));
        const more = text.length > from + max ? `\n\n[… ${text.length - from - max} more characters: read again with from=${from + max}.]` : "";
        return ok(`notes "${existing}" (${text.length} characters):\n${text.slice(from, from + max)}${more}`);
      }
      if (i.action === "append" || i.action === "write") {
        const r = writeNote(store, existing ?? wanted, i.text, i.action === "append");
        if (r.error) return bad(r.error);
        saveWork(chatId, store);
        return ok(`Saved. notes "${existing ?? cleanFileName(wanted)}" is now ${r.size.toLocaleString("en-US")} characters.`);
      }
      return bad("action must be append, write or read.");
    }

    if (call.name === "work_export") {
      const wanted = String(i.name ?? "");
      const format = String(i.format ?? "");
      const table = nameOf(store, wanted, "tables");
      const note = table ? null : nameOf(store, wanted, "notes");
      if (!table && !note) return bad(`There is no work file "${cleanFileName(wanted)}".${others()}`);
      // One deliverable, one file: a work file exported again goes to the file it was exported to before.
      const key = `${table ? "table" : "notes"}:${table ?? note}:${format}`;
      const asked = typeof i.filename === "string" && i.filename.trim() ? cleanFileName(i.filename.replace(/\.[a-z0-9]{2,5}$/i, "")) : "";
      const before = i.new_copy === true ? "" : store.exports?.[key] ?? "";
      const base = before || asked || cleanFileName((table ?? note)!);
      const remember = (r: ToolResult) => {
        if (!r.isError && r.file) {
          store.exports = { ...(store.exports ?? {}), [key]: path.basename(r.file.name, path.extname(r.file.name)) };
          saveWork(chatId, store);
        }
        return r;
      };
      const sameFile = before && asked && asked !== before ? ` (Updated the existing file "${before}" instead of making "${asked}": set new_copy only if the user asked for a separate copy.)` : "";
      if (table) {
        const t = store.tables[table]!;
        if (!t.rows.length) return bad(`"${table}" has no rows yet.`);
        if (format === "xlsx" || format === "csv") {
          const v = exportView(t, fromText(i.columns), fromText(i.empty_columns));
          if (v.unknown.length) return bad(`"${table}" has no column ${v.unknown.map((c) => `"${c}"`).join(", ")}. Its columns: ${t.columns.join(", ")}. To add an empty column to the file, list it in empty_columns too.`);
          const r = await runDocTool({ id: call.id, name: "create_spreadsheet", input: { filename: `${base}.${format}`, sheets: [{ name: table.slice(0, 28), columns: v.columns, rows: v.rows.map((r) => r.map(asText)) }] } }, ws, browser, chatId);
          remember(r);
          return { ...r, name: call.name, content: r.isError ? r.content : `${r.content} It has all ${t.rows.length} rows of "${table}". Filled cells per column: ${filledCounts(v.columns, v.rows)}.${sameFile}` };
        }
        if (format === "docx" || format === "pdf" || format === "md") {
          const r = remember(await asDocument(call, `${base}.${format}`, tableMarkdown(table, t), ws, browser, chatId));
          return r.isError ? r : { ...r, content: `${r.content}${sameFile}` };
        }
        return bad("format must be xlsx, csv, docx, pdf or md.");
      }
      if (format === "xlsx" || format === "csv") return bad(`"${note}" is a notes file: export it as docx, pdf or md.`);
      if (!["docx", "pdf", "md"].includes(format)) return bad("format must be docx, pdf or md for notes.");
      const r = remember(await asDocument(call, `${base}.${format}`, store.notes[note!]!.text, ws, browser, chatId));
      return r.isError ? r : { ...r, content: `${r.content}${sameFile}` };
    }
    return bad(`Unknown tool: ${call.name}`);
  } catch (e) {
    return bad(((e as Error).message || String(e)).slice(0, 400));
  }
}
