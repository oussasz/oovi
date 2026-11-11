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

export const WORK_TOOLS: ReadonlySet<string> = new Set(WORK_SPECS.map((s) => s.name));

/** For every bot's instructions: what the team already has. */
export function workPrompt(chatId: string, group: boolean): string[] {
  const lines = storeLines(loadWork(chatId));
  return [
    "",
    `Work files${group ? " (shared by the whole team in this chat)" : ""}: work_table for lists and work_notes for long text. Anything long (a list, findings, a draft, a detailed report) goes into a work file, not into the chat: the chat message stays short and says what you added and where. Deliver a work file to the user with work_export.`,
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

const nameOf = (store: WorkStore, wanted: string, kind: "tables" | "notes"): string | null => {
  const clean = cleanFileName(wanted);
  if (store[kind][clean]) return clean;
  const lower = clean.toLowerCase();
  return Object.keys(store[kind]).find((k) => k.toLowerCase() === lower) ?? null;
};

export async function runWorkTool(call: ToolCall, chatId: string, ws: Workspace | undefined, browser: BrowserConfig): Promise<ToolResult> {
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
        const r = addRows(store, existing ?? wanted, i.columns, i.rows);
        if (r.error) return bad(r.error);
        saveWork(chatId, store);
        const name = existing ?? cleanFileName(wanted);
        const parts = [`${r.added} added`, r.merged ? `${r.merged} already there and completed` : "", r.skipped ? `${r.skipped} skipped (already there with nothing new, or empty)` : ""].filter(Boolean);
        return ok(`${parts.join(", ")}. Now: ${tableLine(name, store.tables[name]!)}.`);
      }
      if (!existing) return bad(`There is no table "${cleanFileName(wanted)}".${others()}`);
      const t = store.tables[existing]!;
      if (i.action === "read") {
        const r = readRows(t, Number(i.from) || 1, Number(i.limit) || 100, typeof i.missing === "string" ? i.missing : undefined);
        return ok(`${tableLine(existing, t)}\n${typeof i.missing === "string" ? `${r.matching} rows have no ${i.missing}. ` : ""}Showing ${r.shown}:\n${r.text}`);
      }
      if (i.action === "update") {
        const err = updateRow(t, Number(i.row), i.values);
        if (err) return bad(err);
        saveWork(chatId, store);
        return ok(`Row ${Math.floor(Number(i.row))} updated.`);
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
