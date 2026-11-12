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
import { addRows, cleanFileName, emptyStore, readRows, removeRows, storeLines, tableLine, tableMarkdown, updateRow, writeNote, type WorkStore } from "./workfiles-core";

const ID_RE = /^[\w-]{1,64}$/;
const file = (chatId: string) => path.join(dataDir(), "work", `${chatId}.json`);

export function loadWork(chatId: string): WorkStore {
  if (!ID_RE.test(chatId)) return emptyStore();
  try {
    const j = JSON.parse(fs.readFileSync(file(chatId), "utf8")) as Partial<WorkStore>;
    return { tables: j.tables && typeof j.tables === "object" ? j.tables : {}, notes: j.notes && typeof j.notes === "object" ? j.notes : {} };
  } catch {
    return emptyStore();
  }
}

function saveWork(chatId: string, store: WorkStore) {
  if (!ID_RE.test(chatId)) return;
  const f = file(chatId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // Write then rename: a crash mid-write never leaves half a file of the team's work.
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, f);
}

/** The chat was deleted: its work files go with it. */
export function deleteWork(chatId: string) {
  if (ID_RE.test(chatId)) fs.rmSync(file(chatId), { force: true });
}

export const WORK_SPECS: ToolSpec[] = [
  {
    name: "work_table",
    description:
      "The team's shared tables for this chat: every bot adds its rows to the same table, so results add up instead of living in chat messages. Use it for any list you build (prospects, contacts, products, sources, tasks). add: append rows (the table is created on first use with `columns`); a row whose name (first column) or phone number is already there is completed, never repeated. read: see rows (use `missing` to list only rows where a column is still empty). update: change cells of one row. remove: delete rows by number. Add rows as you find them, in batches, rather than all at the end.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "read", "update", "remove"] },
        table: { type: "string", description: "Table name, e.g. 'Prospects Alger'. Use the existing one when the team already has it." },
        columns: { type: "array", items: { type: "string" }, description: "add, new table only: the header row. Put the name first; include a Source column for where each row was found." },
        rows: { type: "array", items: {}, description: "add: rows as arrays in column order, or objects keyed by column name. Leave a cell empty when you don't have the value; never invent one." },
        row: { type: "integer", description: "update: the row number" },
        values: { type: "object", description: "update: {column name: new value}" },
        rows_to_remove: { type: "array", items: { type: "integer" }, description: "remove: row numbers" },
        from: { type: "integer", description: "read: first row number (default 1)" },
        limit: { type: "integer", description: "read: how many rows (default 100, max 500)" },
        missing: { type: "string", description: "read: only rows where this column is empty" },
      },
      required: ["action", "table"],
    },
  },
  {
    name: "work_notes",
    description:
      "The team's shared notes files for this chat: long text that doesn't belong in a chat message (findings, a draft, a detailed report, a review with corrections). There is no length limit worth worrying about: write as much as the work needs, in Markdown. append adds to the end, write replaces the file, read returns it. Your chat message stays short and names the file.",
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
      "Turn a work table or notes file into a real file for the user, complete, without retyping it: a table becomes Excel (.xlsx) or CSV; notes become Word (.docx), PDF or Markdown; a table can also go into a Word or PDF document. Use this (not create_spreadsheet or create_document) to deliver what's in a work file.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The table's or notes file's name" },
        format: { type: "string", enum: ["xlsx", "csv", "docx", "pdf", "md"] },
        filename: { type: "string", description: "Optional file name for the user" },
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
export function workPrompt(chatId: string, group: boolean, fromMain = false): string[] {
  const lines = storeLines(loadWork(chatId));
  return [
    "",
    `Work files${fromMain ? " (the same ones as the main assistant who gave this task: what it already found is in them, and what you add it sees at once; add to its table, don't start another)" : group ? " (shared by the whole team in this chat)" : ""}: work_table for lists and work_notes for long text. Anything long (a list, findings, a draft, a detailed report) goes into a work file, not into the chat: the chat message stays short and says what you added and where. Deliver a work file to the user with work_export.`,
    "Sources for a list: a row needs a source, not a perfect one. A detail you read on any page (a directory, a listing, a map's results, a search result) goes into the table, with that page in the Source column; when you couldn't also see it on the item's own page, write \"to confirm\" in a Status column. Don't hold a found row back while you look for a better source, and never ask the user to copy from a page what a page shows. Only what you read nowhere stays empty. If the user asked for stricter proof, follow the user.",
    ...(lines.length ? ["The work files right now:", ...lines] : []),
  ];
}

/** Text from the web must stay text in Excel: a cell starting with "=" would run as a formula. */
const asText = (c: string) => (/^[=@]/.test(c) ? ` ${c}` : c);

/** Word and PDF have a size limit; Markdown takes any length. */
async function asDocument(call: ToolCall, filename: string, content: string, ws: Workspace | undefined, browser: BrowserConfig): Promise<ToolResult> {
  if (filename.endsWith(".md")) return { ...saveOutput(call, filename, ws, Buffer.from(content, "utf8"), "a document"), name: call.name };
  if (content.length > 380_000) return { id: call.id, name: call.name, content: `That's too long for one ${filename.endsWith(".pdf") ? "PDF" : "Word"} file (${content.length.toLocaleString("en-US")} characters). Export it as md (any length), or split it into several notes files and export each.`, isError: true };
  const r = await runDocTool({ id: call.id, name: "create_document", input: { filename, content } }, ws, browser);
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
  return near.length === 1 ? near[0]! : null;
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
      if (i.action === "add") {
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
        return ok(`${tableLine(existing, t)}\n${typeof i.missing === "string" ? `${r.matching} rows have no ${i.missing}. ` : ""}Showing ${r.shown}:\n${r.text}`);
      }
      if (i.action === "update") {
        const values = fromText(i.values);
        const checked = seen && values && typeof values === "object" && !Array.isArray(values) ? dropUnseen(t.columns, [{ [t.columns[0] ?? "Name"]: t.rows[Math.floor(Number(i.row)) - 1]?.[0] ?? "", ...(values as object) }], seen) : null;
        const safe = checked ? Object.fromEntries(Object.entries((checked.rows as Record<string, unknown>[])[0]!).filter(([k]) => k in (values as object))) : values;
        const err = updateRow(t, Number(i.row), safe);
        if (err) return bad(err);
        saveWork(chatId, store);
        return ok([`Row ${Math.floor(Number(i.row))} updated.`, droppedNote(checked?.dropped ?? [])].filter(Boolean).join("\n"));
      }
      if (i.action === "remove") {
        const n = removeRows(t, i.rows_to_remove);
        if (!n) return bad("No such rows. Give rows_to_remove as row numbers from work_table read.");
        saveWork(chatId, store);
        return ok(`${n} rows removed. Now: ${tableLine(existing, t)}. (Row numbers changed: read again before more changes.)`);
      }
      return bad("action must be add, read, update or remove.");
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
      const base = cleanFileName(typeof i.filename === "string" && i.filename.trim() ? i.filename.replace(/\.[a-z0-9]{2,5}$/i, "") : (table ?? note)!);
      if (table) {
        const t = store.tables[table]!;
        if (!t.rows.length) return bad(`"${table}" has no rows yet.`);
        if (format === "xlsx" || format === "csv") {
          const r = await runDocTool({ id: call.id, name: "create_spreadsheet", input: { filename: `${base}.${format}`, sheets: [{ name: table.slice(0, 28), columns: t.columns, rows: t.rows.map((r) => r.map(asText)) }] } }, ws, browser);
          return { ...r, name: call.name, content: r.isError ? r.content : `${r.content} It has all ${t.rows.length} rows of "${table}".` };
        }
        if (format === "docx" || format === "pdf" || format === "md") return await asDocument(call, `${base}.${format}`, tableMarkdown(table, t), ws, browser);
        return bad("format must be xlsx, csv, docx, pdf or md.");
      }
      if (format === "xlsx" || format === "csv") return bad(`"${note}" is a notes file: export it as docx, pdf or md.`);
      if (!["docx", "pdf", "md"].includes(format)) return bad("format must be docx, pdf or md for notes.");
      return await asDocument(call, `${base}.${format}`, store.notes[note!]!.text, ws, browser);
    }
    return bad(`Unknown tool: ${call.name}`);
  } catch (e) {
    return bad(((e as Error).message || String(e)).slice(0, 400));
  }
}
