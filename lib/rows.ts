// Working on a table without reading it: read_rows (look at chosen rows) and for_each_row (one action per
// row, run by oovi). The table is an attached Excel or CSV file, or one of the chat's work tables. The rules
// (filters, placeholders, the ledger) are in lib/table-core.ts and lib/batch-core.ts; this file finds the
// table, shows the user one card for the whole batch, and runs it.
import fs from "node:fs";
import path from "node:path";
import { attachmentSegments, findAttachment } from "./attachments";
import { batchKey, batchSummary, runBatch, type Outcome } from "./batch-core";
import type { ToolSpec } from "./llm";
import { mcpToolKind } from "./mcp";
import { dataDir } from "./settings";
import { cellsText, fromCsvText, fromSheetText, fromWorkTable, planBatch, selectRows, type BatchPlan, type Table } from "./table-core";
import type { ApprovalItem, Chat, ToolCall, ToolResult } from "./types";
import { findWorkTable } from "./workfiles";

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
      "Look inside a table without loading it: an attached Excel or CSV file, or a work table. Choose rows with `filter` and only the `columns` you need; the answer says how many rows match and shows up to `limit` of them. Use it to look, count or check. To do something for every row, use for_each_row: it works on the table itself, so you don't read the rows first.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "The attached file's name (e.g. 'Leads.xlsx') or the work table's name" },
        sheet: { type: "string", description: "Excel only: the sheet's name or number (default: the first sheet)" },
        filter: FILTER_SCHEMA,
        columns: { type: "array", items: { type: "string" }, description: "Only these columns (default: all)" },
        limit: { type: "integer", description: "How many rows to show (default 20, max 200)" },
        offset: { type: "integer", description: "Skip this many matching rows first (to page through)" },
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
 * The row tools a bot gets. With a connector: both, always (a work table can be made at any moment, and a tool
 * list that changed in the middle of a conversation rewrote its whole prompt cache: tests/e2e/cost-scenario.cjs).
 * Without one there is nothing to run per row: read_rows only, once the user has attached a table.
 */
export function rowSpecsFor(chat: Chat, hasConnector: boolean): ToolSpec[] {
  if (hasConnector) return ROW_SPECS;
  const attached = chat.entries.some((e) => e.kind === "user" && e.attachments?.some((a) => a.kind === "xlsx" || a.kind === "csv"));
  return attached ? ROW_SPECS.filter((t) => t.name === READ_ROWS) : [];
}

type Source = { name: string; table: Table };

/** The table a bot names: an attachment of this chat first, then a work table. */
function sourceOf(chat: Chat, workChat: string, wanted: unknown, sheet: unknown): Source | { error: string } {
  const name = String(wanted ?? "").trim();
  if (!name) return { error: "source is required: the attached file's name or the work table's name." };
  const att = findAttachment(chat, name);
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
