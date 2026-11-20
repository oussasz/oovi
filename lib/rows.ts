// Working on a table without reading it: read_rows (look at chosen rows) and for_each_row (one action per
// row, run by oovi). The table is an attached Excel or CSV file, or one of the chat's work tables. The rules
// (filters, placeholders, the ledger) are in lib/table-core.ts and lib/batch-core.ts; this file finds the
// table, shows the user one card for the whole batch, and runs it.
import fs from "node:fs";
import path from "node:path";
import { attachmentSegments, findAttachment } from "./attachments";
import { cloudRunner } from "./cloud-flag";
import { HAND_TO_COMPUTER } from "./cloud-runner-core";
import { batchKey, batchSummary, runBatch, type Outcome } from "./batch-core";
import type { ToolSpec } from "./llm";
import { mcpToolKind } from "./mcp";
import { dataDir } from "./settings";
import { cellsText, fromCsvText, fromSheetText, fromWorkTable, planBatch, selectRows, summarize, type BatchPlan, type Table } from "./table-core";
import type { ApprovalItem, Chat, ToolCall, ToolResult } from "./types";
import { findWorkTable, putTable } from "./workfiles";

export const READ_ROWS = "read_rows";
export const FOR_EACH_ROW = "for_each_row";

const FILTER_SCHEMA = {
  type: "array",
  description: 'Keep only the rows where every condition holds, e.g. [{"column":"City","op":"=","value":"Alger"}]. Only for what the user asked to narrow: when they said everyone or all, leave it out (rows with an empty value the action needs are skipped anyway). A doubt of your own about some rows is not a filter: it goes in `note`.',
  items: {
    type: "object",
    properties: {
      column: { type: "string" },
      op: { type: "string", enum: ["=", "!=", "contains", "not_contains", "empty", "not_empty", ">", "<", ">=", "<=", "in", "not_in"] },
      value: { description: "Text or a number; a list for in / not_in; nothing for empty / not_empty" },
    },
    required: ["column", "op"],
  },
};

export const ROW_SPECS: ToolSpec[] = [
  {
    name: READ_ROWS,
    description:
      "Work on a table without loading it: an attached Excel or CSV file, or a work table. Look: choose rows with `filter` and only the `columns` you need; the answer says how many rows match and shows up to `limit` of them. Count and add up: `group_by` gives the number of rows per value of a column (biggest first), with `values` for sums, averages, minimum and maximum; one call answers \"which city has the most\", \"the total per month\". Take a part of it: `save_to_table` copies every matching row into a work table, exactly, and work_export then delivers it as Excel or CSV; never retype rows to make a file. To do something for every row, use for_each_row when you have it.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "The attached file's name (e.g. 'Leads.xlsx') or the work table's name" },
        sheet: { type: "string", description: "Excel only: the sheet's name or number (default: the first sheet)" },
        filter: FILTER_SCHEMA,
        columns: { type: "array", items: { type: "string" }, description: "Only these columns (default: all)" },
        limit: { type: "integer", description: "How many rows to show (default 20, max 200)" },
        offset: { type: "integer", description: "Skip this many matching rows first (to page through)" },
        group_by: { type: "array", items: { type: "string" }, description: "Count the matching rows per value of these columns instead of showing them, e.g. [\"City\"]" },
        values: { type: "array", description: "With or without group_by: numbers to compute, e.g. [{\"op\":\"sum\",\"column\":\"Amount\"}]", items: { type: "object", properties: { op: { type: "string", enum: ["sum", "avg", "min", "max", "count"] }, column: { type: "string" } }, required: ["op", "column"] } },
        top: { type: "integer", description: "With group_by: only the N biggest groups (default 50)" },
        save_to_table: { type: "string", description: "Copy every matching row (the chosen columns) into a work table of this name, exactly as it is; then deliver it with work_export" },
      },
      required: ["source"],
    },
  },
  {
    name: FOR_EACH_ROW,
    description:
      "Do the same thing once for each row of a table (an attached Excel or CSV file, or a work table): send each person an email or a message, create one record per row, and so on. Give the tool to run and its input ONCE, writing {Column name} wherever a value comes from the row. oovi fills it in for every row from the file itself, leaves out rows where that value is empty and repeats of `unique_by`, and runs them all. The user gets one card with the number of rows and three filled-in examples, and approves once for the whole batch. A row already done is never done again, so making the same call again finishes a batch that stopped. This is the way to act on a list: never one call per row, and never copy rows or addresses into your own calls. Every row gets the same text, so write it to be true for all of them; what differs comes from a column, or from a second call with another filter and another text. A doubt about who is included or about the wording doesn't need a question first: put it in `note`, the user reads it on the card and can cancel.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "The attached file's name (e.g. 'Leads.xlsx') or the work table's name" },
        sheet: { type: "string", description: "Excel only: the sheet's name or number (default: the first sheet)" },
        filter: FILTER_SCHEMA,
        unique_by: { type: "string", description: "A column whose value must not repeat, e.g. the email column: each address gets one message" },
        tool: { type: "string", description: "The tool to run for each row, by its exact name (a connector tool, e.g. the one that sends an email or creates a record)" },
        input: { type: "object", description: "That tool's input for ONE row, exactly as you would call it once, with {Column name} placeholders, e.g. {\"to\":\"{Email}\",\"subject\":\"Hello {Company}\"}" },
        limit: { type: "integer", description: "Only the first N rows (for a trial run)" },
        note: { type: "string", description: "One short line shown to the user on the card, in their language: what they should know before approving (a choice you made, a doubt). E.g. 'Includes the 40 rows marked Refused: tell me if you want them left out.'" },
      },
      required: ["source", "tool", "input"],
    },
  },
];

export const ROW_TOOLS: ReadonlySet<string> = new Set(ROW_SPECS.map((s) => s.name));

/**
 * The row tools a bot gets: read_rows always, for_each_row with a connector (without one there is nothing to
 * run per row). Always, whether or not a table is there yet: the tool list is the first thing in a request,
 * and a list that changes (a file attached, a work table made) rewrites the whole prompt cache, the shared
 * rules included (measured: a first message with a file read nothing from the cache; tests/e2e/cost-scenario.cjs).
 */
export function rowSpecsFor(hasConnector: boolean): ToolSpec[] {
  return hasConnector ? ROW_SPECS : ROW_SPECS.filter((t) => t.name === READ_ROWS);
}

type Source = { name: string; table: Table };

/** The table a bot names: an attachment of this chat first, then a work table. */
function sourceOf(chat: Chat, workChat: string, wanted: unknown, sheet: unknown): Source | { error: string } {
  const name = String(wanted ?? "").trim();
  if (!name) return { error: "source is required: the attached file's name or the work table's name." };
  const att = findAttachment(chat, name);
  // On oovi's cloud server the files the user attached are not there: they stay on the computer.
  if (att && cloudRunner()) return { error: `"${att.name}" is on the user's computer, which is off. If the request needs it, call ${HAND_TO_COMPUTER}.` };
  if (att) {
    const segs = attachmentSegments(chat.id, att.id).filter((s) => s.text.trim());
    if (att.kind === "csv") return { name: att.name, table: fromCsvText(segs[0]?.text ?? "") };
    if (att.kind !== "xlsx") return { error: `"${att.name}" is not a table (Excel .xlsx or CSV). Read it with read_attachment.` };
    const sheets = segs.filter((s) => s.label.startsWith("Sheet"));
    let seg: { label: string; text: string } | undefined = sheets[0];
    if (sheet !== undefined && sheet !== null && String(sheet).trim()) {
      const q = String(sheet).trim().toLowerCase();
      seg = sheets.find((s) => s.label.toLowerCase() === `sheet: ${q}`) ?? (/^\d+$/.test(q) ? sheets[Number(q) - 1] : undefined) ?? sheets.find((s) => s.label.toLowerCase().includes(q));
      if (!seg) return { error: `No sheet "${String(sheet)}" in "${att.name}". Sheets: ${sheets.map((s) => s.label.replace(/^Sheet: /, "")).join(", ") || "none"}.` };
    }
    if (!seg) return { error: `"${att.name}" has no rows that could be read.` };
    return { name: att.name, table: fromSheetText(seg.text) };
  }
  const work = findWorkTable(workChat, name);
  if (work) return { name: work.name, table: fromWorkTable(work.columns, work.rows) };
  return { error: `There is no attached table or work table called "${name}" in this chat.` };
}

const fail = (call: ToolCall, content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });

const READ_MAX_CHARS = 12_000;

export function runReadRows(call: ToolCall, chat: Chat, workChat: string): ToolResult {
  const i = call.input;
  const src = sourceOf(chat, workChat, i.source, i.sheet);
  if ("error" in src) return fail(call, src.error);
  // Counting and adding up per group: the numbers are computed here, the rows are not shown.
  if (i.group_by !== undefined || i.values !== undefined) {
    const top = Math.min(200, Math.max(1, Math.floor(Number(i.top) || 50)));
    const sum = summarize(src.table, { groupBy: i.group_by, values: i.values, filter: i.filter, top });
    if ("error" in sum) return fail(call, sum.error);
    const more = sum.groups > sum.rows.length ? `\n[${sum.groups - sum.rows.length} smaller groups not shown: ask with a bigger top, or a filter.]` : "";
    return { id: call.id, name: call.name, content: `"${src.name}": ${sum.matching} of ${src.table.rows.length} rows match${i.group_by !== undefined ? `, in ${sum.groups} groups (biggest first)` : ""}. Computed from the table:\n${sum.columns.join(" | ")}\n${sum.rows.map((r) => r.join(" | ")).join("\n")}${more}` };
  }
  // A part of the table as a table of its own: copied here, row for row, never retyped.
  if (typeof i.save_to_table === "string" && i.save_to_table.trim()) {
    const all = selectRows(src.table, { filter: i.filter, columns: i.columns });
    if ("error" in all) return fail(call, all.error);
    if (!all.rows.length) return fail(call, `No row of "${src.name}" passes the filter: nothing was copied.`);
    const put = putTable(workChat, i.save_to_table, all.columns, all.rows.map((r) => r.cells));
    if ("error" in put) return fail(call, put.error);
    return { id: call.id, name: call.name, content: `Copied ${put.rows} rows (of ${src.table.rows.length}) from "${src.name}" into the work table "${put.name}", exactly as they are, with the columns: ${all.columns.join(", ")}. To give it to the user as a file: work_export with name "${put.name}".` };
  }
  const limit = Math.min(200, Math.max(1, Math.floor(Number(i.limit) || 20)));
  const offset = Math.max(0, Math.floor(Number(i.offset) || 0));
  const sel = selectRows(src.table, { filter: i.filter, columns: i.columns, limit, offset });
  if ("error" in sel) return fail(call, sel.error);
  let rows = sel.rows;
  let text = cellsText(sel.columns, rows);
  while (text.length > READ_MAX_CHARS && rows.length > 1) {
    rows = rows.slice(0, Math.ceil(rows.length / 2));
    text = cellsText(sel.columns, rows);
  }
  const upTo = offset + rows.length;
  const more = upTo < sel.matching ? `\n[${sel.matching - upTo} more matching rows: read on with offset=${upTo}, or narrow with filter and columns. To act on all of them, use for_each_row: no need to read them.]` : "";
  return { id: call.id, name: call.name, content: `"${src.name}": ${sel.matching} of ${src.table.rows.length} rows match. Showing ${rows.length}${offset ? ` (from match ${offset + 1})` : ""}:\n${text}${more}` };
}

// ---------- for_each_row ----------

type Planned = { src: Source; plan: BatchPlan; tool: string; act: boolean };

/** The batch a call asks for, checked: the table exists, the tool is one this bot has, the input names real columns. */
export function planFor(call: ToolCall, chat: Chat, workChat: string, tools: ToolSpec[]): Planned | { error: string } {
  const i = call.input;
  const tool = String(i.tool ?? "").trim();
  if (!tool) return { error: "tool is required: the exact name of the tool to run for each row." };
  if (!tool.startsWith("mcp_")) return { error: `for_each_row runs a connected app's tool (their names start with mcp_). "${tool}" isn't one.` };
  if (!tools.some((t) => t.name === tool)) return { error: `You have no tool named "${tool}". Use the exact name of one of your connector tools.` };
  if (!i.input || typeof i.input !== "object" || Array.isArray(i.input)) return { error: "input is required: the tool's input for one row, as an object, with {Column name} placeholders." };
  const src = sourceOf(chat, workChat, i.source, i.sheet);
  if ("error" in src) return src;
  const limit = Number(i.limit) > 0 ? Math.floor(Number(i.limit)) : undefined;
  const plan = planBatch(src.table, { input: i.input, filter: i.filter, ...(typeof i.unique_by === "string" && i.unique_by.trim() ? { uniqueBy: i.unique_by.trim() } : {}), ...(limit ? { limit } : {}) });
  if ("error" in plan) return plan;
  if (!plan.items.length) return { error: `No row to act on in "${src.name}": ${plan.skipped.empty ? `${plan.skipped.empty} rows have an empty value the input needs` : "no row passes the filter"}.` };
  return { src, plan, tool, act: mcpToolKind(tool) === "act" };
}

const ledgerFile = (chatId: string) => path.join(dataDir(), "chats", chatId, "batches.jsonl");

function ledgerOf(chatId: string): Set<string> {
  const out = new Set<string>();
  try {
    for (const line of fs.readFileSync(ledgerFile(chatId), "utf8").split("\n")) {
      if (!line) continue;
      try {
        out.add((JSON.parse(line) as { k: string }).k);
      } catch {
        /* a half-written last line */
      }
    }
  } catch {
    /* no batch has run in this chat yet */
  }
  return out;
}

function record(chatId: string, key: string, outcome: Outcome) {
  const file = ledgerFile(chatId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ k: key, o: outcome, at: Date.now() })}\n`);
}

/** A batch that acts (sends, creates, changes) always shows its card, in Auto mode and for a trusted connector too. */
export function batchAsks(call: ToolCall, chat: Chat, workChat: string, tools: ToolSpec[]): boolean {
  const p = planFor(call, chat, workChat, tools);
  return !("error" in p) && p.act;
}

type Tr = (key: "batch.head" | "batch.from" | "batch.filtered" | "batch.skipEmpty" | "batch.skipDup" | "batch.already" | "batch.example", vars?: Record<string, string | number>) => string;

/** A filter as the card says it: "Statut ≠ Refusé, Email not empty". */
function filterWords(raw: unknown): string {
  const sign: Record<string, string> = { "=": "=", "!=": "≠", contains: "∋", not_contains: "∌", empty: "∅", not_empty: "≠ ∅", in: "∈", not_in: "∉" };
  return (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((f) => {
      const { column, op, value } = (f ?? {}) as { column?: unknown; op?: unknown; value?: unknown };
      const o = String(op ?? "=");
      const v = o === "empty" || o === "not_empty" ? "" : ` ${Array.isArray(value) ? value.join(" / ") : String(value ?? "")}`;
      return `${String(column ?? "")} ${sign[o] ?? o}${v}`.trim();
    })
    .join(", ")
    .slice(0, 200);
}

/** The one card for the whole batch: how many, from where, what is left out, and three rows filled in. */
export function batchApprovalItem(call: ToolCall, chat: Chat, workChat: string, tools: ToolSpec[], describe: (c: ToolCall) => string, tr: Tr): ApprovalItem {
  const p = planFor(call, chat, workChat, tools);
  if ("error" in p) return { call, summary: p.error };
  const done = ledgerOf(chat.id);
  const todo = p.plan.items.filter((it) => !done.has(batchKey(p.tool, it.input)));
  const already = p.plan.items.length - todo.length;
  const shown = (todo.length ? todo : p.plan.items).slice(0, 3);
  const said = shown.map((it) => describe({ id: call.id, name: p.tool, input: it.input as Record<string, unknown> }));
  const head = (said[0] ?? p.tool).split("\n")[0]!;
  const note = typeof call.input.note === "string" ? call.input.note.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const lines = [
    tr("batch.head", { n: todo.length, what: head }),
    tr("batch.from", { source: p.src.name }),
    note,
    p.plan.filteredOut ? tr("batch.filtered", { n: p.plan.filteredOut, filter: filterWords(call.input.filter) }) : "",
    p.plan.skipped.empty ? tr("batch.skipEmpty", { n: p.plan.skipped.empty }) : "",
    p.plan.skipped.duplicate ? tr("batch.skipDup", { n: p.plan.skipped.duplicate }) : "",
    already ? tr("batch.already", { n: already }) : "",
    ...shown.flatMap((it, k) => ["", tr("batch.example", { i: k + 1, n: it.n }), ...said[k]!.split("\n").slice(1)]),
  ].filter((l, k, a) => l !== "" || (k > 0 && a[k - 1] !== ""));
  // The bot narrowed the batch: the card also offers every row, so the user settles it with one press.
  let all = 0;
  if (p.plan.filteredOut) {
    const wide = planFor({ ...call, input: { ...call.input, filter: undefined } }, chat, workChat, tools);
    if (!("error" in wide)) all = wide.plan.items.filter((it) => !done.has(batchKey(p.tool, it.input))).length;
  }
  return { call, summary: lines.join("\n"), detail: `${p.tool}\n${JSON.stringify(call.input.input, null, 1).slice(0, 3000)}`, ...(all > todo.length ? { batchAll: all } : {}) };
}

export async function runForEachRow(
  call: ToolCall,
  o: { chat: Chat; workChat: string; tools: ToolSpec[]; runOne: (c: ToolCall) => Promise<ToolResult>; signal: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<ToolResult> {
  const p = planFor(call, o.chat, o.workChat, o.tools);
  if ("error" in p) return fail(call, p.error);
  const done = ledgerOf(o.chat.id);
  let k = 0;
  const r = await runBatch(p.plan.items, {
    keyOf: (it) => batchKey(p.tool, it.input),
    done,
    signal: o.signal,
    onProgress: o.onProgress,
    record: (key, outcome) => record(o.chat.id, key, outcome),
    run: async (it) => {
      const one = await o.runOne({ id: `${call.id}_${++k}`, name: p.tool, input: it.input as Record<string, unknown> });
      return { ok: !one.isError, text: one.content, maybeRan: !!one.isError && /may have run/i.test(one.content) };
    },
  });
  const text = batchSummary(r, { total: p.plan.items.length, skippedEmpty: p.plan.skipped.empty, skippedDuplicate: p.plan.skipped.duplicate, source: p.src.name });
  // Nothing done at all is a failure the bot must not report as a success.
  return { id: call.id, name: call.name, content: text, ...(r.done + r.already === 0 ? { isError: true } : {}) };
}
