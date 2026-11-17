// The Canvas of a chat (components/Canvas.tsx): its work tables, notes and charts as pages the user reads
// and edits beside the chat. GET lists or reads, PATCH applies one edit made by hand, POST exports a page
// to a real file (the same export the bots use: one deliverable, one file).
import { applyEdit, chartData, restoreSnapshot, type CanvasEdit } from "@/lib/canvas-core";
import { guard } from "@/lib/guard";
import { loadSettings } from "@/lib/settings";
import { getChat } from "@/lib/store";
import { loadHistory, loadWork, runWorkTool, saveWork } from "@/lib/workfiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Chat not found." }, { status: 404 });
const PAGE = 200;

export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const chat = getChat((await params).id);
  if (!chat) return notFound();
  const store = loadWork(chat.id);
  const q = new URL(req.url).searchParams;

  const table = q.get("table");
  if (table !== null) {
    const t = store.tables[table];
    if (!t) return Response.json({ error: "That table isn't there any more." }, { status: 404 });
    const from = Math.max(0, Math.floor(Number(q.get("from")) || 0));
    return Response.json({ columns: t.columns, rows: t.rows.slice(from, from + PAGE), from, total: t.rows.length, updatedAt: t.updatedAt });
  }
  const note = q.get("note");
  if (note !== null) {
    const n = store.notes[note];
    if (!n) return Response.json({ error: "That page isn't there any more." }, { status: 404 });
    return Response.json({ text: n.text, updatedAt: n.updatedAt });
  }
  const chart = q.get("chart");
  if (chart !== null) {
    const c = store.charts?.[chart];
    if (!c) return Response.json({ error: "That chart isn't there any more." }, { status: 404 });
    return Response.json({ chart: c, data: chartData(store.tables[c.table], c), tableUpdatedAt: store.tables[c.table]?.updatedAt ?? 0 });
  }
  if (q.get("history") !== null) {
    const kind = q.get("kind");
    const name = q.get("name");
    const list = loadHistory(chat.id)
      .filter((s) => (!kind || s.kind === kind) && (!name || s.name === name))
      .reverse()
      .map((s) => ({ id: s.id, at: s.at, kind: s.kind, name: s.name, size: s.kind === "table" ? `${(s.data as { rows: unknown[] }).rows.length} rows` : `${(s.data as { text: string }).text.length} characters` }));
    return Response.json({ history: list });
  }

  return Response.json({
    tables: Object.entries(store.tables).map(([name, t]) => ({ name, columns: t.columns.length, rows: t.rows.length, updatedAt: t.updatedAt })),
    notes: Object.entries(store.notes).map(([name, n]) => ({ name, chars: n.text.length, updatedAt: n.updatedAt })),
    charts: Object.entries(store.charts ?? {}).map(([name, c]) => ({ name, table: c.table, type: c.type, updatedAt: Math.max(c.updatedAt, store.tables[c.table]?.updatedAt ?? 0) })),
  });
}

/** One edit made by hand ({op, …}, lib/canvas-core.ts CanvasEdit), or {op: "restore", id} for an earlier version. */
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const chat = getChat((await params).id);
  if (!chat) return notFound();
  const text = await req.text();
  if (text.length > 2_100_000) return Response.json({ error: "That is too much text for one page." }, { status: 413 });
  type Edit = CanvasEdit | { op: "restore"; id: string };
  const parse = (): Edit | null => {
    try {
      const j = JSON.parse(text) as Edit | null;
      return j && typeof j === "object" && typeof j.op === "string" ? j : null;
    } catch {
      return null;
    }
  };
  const e = parse();
  if (!e) return Response.json({ error: "Invalid request." }, { status: 400 });
  // Read, change and save without waiting in between: a bot writing at the same moment can't be overwritten.
  const store = loadWork(chat.id);
  if (e.op === "restore") {
    const id = e.id;
    const snap = loadHistory(chat.id).find((s) => s.id === id);
    if (!snap) return Response.json({ error: "That version isn't kept any more." }, { status: 404 });
    restoreSnapshot(store, snap);
  } else {
    const err = applyEdit(store, e);
    if (err) return Response.json({ error: err }, { status: 400 });
  }
  saveWork(chat.id, store);
  return Response.json({ ok: true });
}

/** {kind: "table" | "note", name, format}: the page as a real file in Downloads/oovi (or the project folder). */
export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const chat = getChat((await params).id);
  if (!chat) return notFound();
  const b = (await req.json().catch(() => null)) as { name?: unknown; format?: unknown } | null;
  const format = String(b?.format ?? "");
  if (typeof b?.name !== "string" || !["xlsx", "csv", "docx", "pdf", "md"].includes(format)) return Response.json({ error: "Choose a page and a format." }, { status: 400 });
  const r = await runWorkTool({ id: "canvas-export", name: "work_export", input: { name: b.name, format } }, chat.id, chat.workspace, loadSettings().browser);
  if (r.isError || !r.file) return Response.json({ error: r.content.slice(0, 300) }, { status: 400 });
  return Response.json({ file: r.file });
}
