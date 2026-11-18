"use client";

// The Canvas: a panel beside the chat with the chat's pages (notes and plans, tables, charts). The bots
// write there while they work (work_notes, work_table) and the user reads and edits by hand, at no AI
// cost. Charts are drawn from a table's columns and follow its numbers. Every page keeps a few earlier
// versions, and exports to a real file with one click (the same export the bots use).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { numericColumns } from "@/lib/canvas-core";
import { ChartView, type ChartType } from "./ChartView";
import { useI18n } from "./I18n";
import Icon from "./Icon";
import { PageView } from "./PageView";
import { toggleBox } from "@/lib/page-blocks";

type Kind = "note" | "table" | "chart";
type Index = {
  tables: { name: string; columns: number; rows: number; updatedAt: number }[];
  notes: { name: string; chars: number; updatedAt: number }[];
  charts: { name: string; table: string; type: ChartType; updatedAt: number }[];
};
type Sel = { kind: Kind; name: string };
type TableData = { columns: string[]; rows: string[][]; total: number; updatedAt: number };
type ChartPayload = { chart: { table: string; type: ChartType; x: string; y: string[]; title: string }; data: { categories: string[]; series: { name: string; values: (number | null)[] }[]; colors: string[] } };
type Version = { id: string; at: number; kind: "table" | "note"; name: string; size: string };
type MadeFile = { path: string; name: string; size: number };

const CHART_TYPES: ChartType[] = ["column", "bar", "line", "area", "pie", "doughnut"];
const key = (s: Sel) => `${s.kind}:${s.name}`;
const enc = encodeURIComponent;

export function Canvas({ chatId, running, onClose }: { chatId: string; running: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const base = `/api/chats/${chatId}/canvas`;
  const [index, setIndex] = useState<Index | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [made, setMade] = useState<MadeFile | null>(null);
  const [menu, setMenu] = useState<"" | "new" | "export" | "history" | "chart" | "share">("");
  // Pages shared by a public link (lib/shares.ts), by "kind:name".
  const [shares, setShares] = useState<Record<string, { url: string; at: number }>>({});
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  // A name to type (a page's, a column's): a small field in the panel (the desktop app has no prompt box).
  const [asking, setAsking] = useState<{ label: string; value: string; ok: (v: string) => void } | null>(null);
  const ask = useCallback((label: string, value: string, ok: (v: string) => void) => setAsking({ label, value, ok }), []);
  // While the user is typing in a page, a refresh from the bots' side must not replace what they type.
  const editing = useRef(false);
  const [tick, setTick] = useState(0);

  const loadShares = useCallback(async () => {
    try {
      setShares((await api<{ shares: Record<string, { url: string; at: number }> }>(`/api/chats/${chatId}/share`)).shares);
    } catch {
      /* none shown */
    }
  }, [chatId]);
  useEffect(() => void loadShares(), [loadShares]);
  async function share(s: Sel, update: boolean) {
    if (s.kind === "chart") return;
    setSharing(true);
    setMsg(null);
    try {
      const r = await api<{ share: { url: string; at: number } }>(`/api/chats/${chatId}/share`, { method: "POST", body: JSON.stringify({ kind: s.kind, name: s.name }) });
      setShares((cur) => ({ ...cur, [key(s)]: r.share }));
      if (!update) void navigator.clipboard?.writeText(r.share.url).then(() => setCopied(true)).catch(() => {});
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSharing(false);
    }
  }
  async function unshare(s: Sel) {
    setSharing(true);
    setMsg(null);
    try {
      await api(`/api/chats/${chatId}/share`, { method: "DELETE", body: JSON.stringify({ kind: s.kind, name: s.name }) });
      setShares((cur) => {
        const n = { ...cur };
        delete n[key(s)];
        return n;
      });
      setMenu("");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSharing(false);
    }
  }

  const loadIndex = useCallback(async () => {
    try {
      const i = await api<Index>(base);
      setIndex(i);
      setSel((cur) => {
        const all: Sel[] = [...i.notes.map((n) => ({ kind: "note" as const, name: n.name })), ...i.tables.map((x) => ({ kind: "table" as const, name: x.name })), ...i.charts.map((c) => ({ kind: "chart" as const, name: c.name }))];
        if (cur && all.some((a) => key(a) === key(cur))) return cur;
        // Nothing chosen (or it was deleted): the page changed last.
        const stamp = (a: Sel) => (a.kind === "note" ? i.notes : a.kind === "table" ? i.tables : i.charts).find((x) => x.name === a.name)?.updatedAt ?? 0;
        return all.sort((a, b) => stamp(b) - stamp(a))[0] ?? null;
      });
    } catch {
      /* the chat was deleted or the app is closing */
    }
  }, [base]);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);
  // Bots at work: the pages fill in while the user watches.
  useEffect(() => {
    const every = setInterval(
      () => {
        if (document.hidden) return;
        void loadIndex();
        if (!editing.current) setTick((n) => n + 1);
      },
      running ? 2500 : 15_000,
    );
    return () => clearInterval(every);
  }, [running, loadIndex]);

  const edit = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setMsg(null);
      try {
        await api(base, { method: "PATCH", body: JSON.stringify(body) });
        return true;
      } catch (e) {
        setMsg((e as Error).message);
        return false;
      }
    },
    [base],
  );
  const refresh = () => {
    void loadIndex();
    setTick((n) => n + 1);
  };

  async function create(kind: "note" | "table") {
    setMenu("");
    const names = new Set([...(index?.notes ?? []), ...(index?.tables ?? []), ...(index?.charts ?? [])].map((x) => x.name));
    const stem = kind === "note" ? t("cv.newPageName") : t("cv.newTableName");
    let name = stem;
    for (let n = 2; names.has(name); n++) name = `${stem} ${n}`;
    if (await edit(kind === "note" ? { op: "newNote", name } : { op: "newTable", name, columns: [t("cv.colName"), t("cv.colNotes")] })) {
      setSel({ kind, name });
      refresh();
    }
  }

  async function exportAs(format: string) {
    if (!sel || sel.kind === "chart") return;
    setMenu("");
    setMsg(null);
    try {
      const r = await api<{ file: MadeFile }>(base, { method: "POST", body: JSON.stringify({ name: sel.name, format }) });
      setMade(r.file);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  function rename() {
    if (!sel) return;
    const cur = sel;
    ask(t("cv.renamePrompt"), cur.name, async (to) => {
      if (to === cur.name) return;
      if (await edit({ op: "rename", kind: cur.kind, name: cur.name, to })) {
        setSel({ kind: cur.kind, name: to.slice(0, 60) });
        refresh();
      }
    });
  }
  async function remove() {
    if (!sel || !window.confirm(t("cv.deleteConfirm", { name: sel.name }))) return;
    if (await edit({ op: "delete", kind: sel.kind, name: sel.name })) {
      setSel(null);
      refresh();
    }
  }

  const pages: (Sel & { icon: "note" | "table" | "chart" })[] = index
    ? [...index.notes.map((n) => ({ kind: "note" as const, name: n.name, icon: "note" as const })), ...index.tables.map((x) => ({ kind: "table" as const, name: x.name, icon: "table" as const })), ...index.charts.map((c) => ({ kind: "chart" as const, name: c.name, icon: "chart" as const }))]
    : [];
  const bridge = typeof window !== "undefined" ? window.oovi : undefined;
  const formats = sel?.kind === "table" ? ["xlsx", "csv", "docx", "pdf"] : ["docx", "pdf", "md"];

  return (
    <aside className="canvas" aria-label={t("cv.title")}>
      <div className="cv-head">
        <b>{t("cv.title")}</b>
        {running && <span className="cv-live">{t("cv.live")}</span>}
        <span className="cv-grow" />
        <div className="cv-menu-wrap">
          <button className="btn sm" onClick={() => setMenu(menu === "new" ? "" : "new")} aria-expanded={menu === "new"}>
            <Icon name="plus" size={14} /> {t("cv.new")}
          </button>
          {menu === "new" && (
            <div className="cv-menu" role="menu">
              <button role="menuitem" onClick={() => void create("note")}>
                <Icon name="note" size={16} /> {t("cv.newPage")}
              </button>
              <button role="menuitem" onClick={() => void create("table")}>
                <Icon name="table" size={16} /> {t("cv.newTable")}
              </button>
            </div>
          )}
        </div>
        <button className="icon-btn sm" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
          <Icon name="close" size={16} />
        </button>
      </div>

      {pages.length > 0 && (
        <div className="cv-tabs" role="tablist" aria-label={t("cv.pages")}>
          {pages.map((p) => (
            <button key={key(p)} role="tab" aria-selected={!!sel && key(sel) === key(p)} className={`cv-tab${sel && key(sel) === key(p) ? " on" : ""}`} onClick={() => (setSel({ kind: p.kind, name: p.name }), setMenu(""), setMade(null))} title={p.name}>
              <Icon name={p.icon} size={14} />
              <span dir="auto">{p.name}</span>
            </button>
          ))}
        </div>
      )}

      {sel && (
        <div className="cv-bar">
          <button className="cv-name" onClick={rename} title={t("cv.rename")} dir="auto">
            {sel.name}
          </button>
          <span className="cv-grow" />
          {sel.kind === "table" && (
            <button className="btn sm" onClick={() => setMenu(menu === "chart" ? "" : "chart")} aria-expanded={menu === "chart"}>
              <Icon name="chart" size={14} /> {t("cv.chart")}
            </button>
          )}
          {sel.kind !== "chart" && (
            <>
              <div className="cv-menu-wrap">
                <button className="btn sm" onClick={() => setMenu(menu === "export" ? "" : "export")} aria-expanded={menu === "export"}>
                  <Icon name="download" size={14} /> {t("cv.export")}
                </button>
                {menu === "export" && (
                  <div className="cv-menu end" role="menu">
                    {formats.map((f) => (
                      <button key={f} role="menuitem" onClick={() => void exportAs(f)}>
                        {t(`cv.format.${f}` as "cv.format.xlsx")}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="cv-menu-wrap">
                <button className={`btn sm${shares[key(sel)] ? " on" : ""}`} onClick={() => (setMenu(menu === "share" ? "" : "share"), setCopied(false))} aria-expanded={menu === "share"}>
                  <Icon name="globe" size={14} /> {t(shares[key(sel)] ? "cv.shared" : "cv.share")}
                </button>
                {menu === "share" && (
                  <div className="cv-menu end cv-share" role="dialog" aria-label={t("cv.share")}>
                    {shares[key(sel)] ? (
                      <>
                        <p>{t("cv.shareOn")}</p>
                        <div className="cv-share-link">
                          <input readOnly value={shares[key(sel)]!.url} onFocus={(e) => e.target.select()} aria-label={t("cv.shareLink")} />
                          <button className="btn sm primary" onClick={() => void navigator.clipboard?.writeText(shares[key(sel)]!.url).then(() => setCopied(true)).catch(() => {})}>
                            {t(copied ? "chat.copied" : "cv.copyLink")}
                          </button>
                        </div>
                        <p className="cv-share-note">{t("cv.shareSnapshot", { when: new Date(shares[key(sel)]!.at).toLocaleString() })}</p>
                        <div className="row-btns">
                          <button className="btn sm" disabled={sharing} onClick={() => void share(sel, true)}>
                            {t("cv.shareUpdate")}
                          </button>
                          <button className="btn sm danger" disabled={sharing} onClick={() => void unshare(sel)}>
                            {t("cv.shareStop")}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p>{t("cv.shareWhat")}</p>
                        <button className="btn sm primary" disabled={sharing} onClick={() => void share(sel, false)}>
                          {sharing ? t("cv.sharing") : t("cv.shareMake")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button className={`icon-btn sm${menu === "history" ? " on" : ""}`} onClick={() => setMenu(menu === "history" ? "" : "history")} title={t("cv.history")} aria-label={t("cv.history")} aria-expanded={menu === "history"}>
                <Icon name="clock" size={16} />
              </button>
            </>
          )}
          <button className="icon-btn sm" onClick={() => void remove()} title={t("cv.delete")} aria-label={t("cv.delete")}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      )}

      {asking && (
        <form
          className="cv-ask"
          onSubmit={(e) => {
            e.preventDefault();
            const v = asking.value.trim();
            setAsking(null);
            if (v) asking.ok(v);
          }}
        >
          <label>
            {asking.label}
            <input autoFocus dir="auto" maxLength={60} value={asking.value} onChange={(e) => setAsking({ ...asking, value: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setAsking(null)} />
          </label>
          <button className="btn sm primary" disabled={!asking.value.trim()}>
            {t("cv.ok")}
          </button>
          <button type="button" className="btn sm" onClick={() => setAsking(null)}>
            {t("cv.cancel")}
          </button>
        </form>
      )}
      {msg && (
        <p className="cv-msg" role="alert">
          {msg}
        </p>
      )}
      {made && (
        <div className="cv-made" role="status">
          <span dir="auto">
            {t("cv.saved")} <b>{made.name}</b>
          </span>
          {bridge?.openFile && (
            <button className="btn sm primary" onClick={() => void bridge.openFile!(made.path)}>
              {t("chat.openFile")}
            </button>
          )}
          {bridge?.showFile && (
            <button className="btn sm" onClick={() => void bridge.showFile!(made.path)}>
              {t("chat.showInFolder")}
            </button>
          )}
          <button className="icon-btn sm" onClick={() => setMade(null)} aria-label={t("common.close")}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div className="cv-body">
        {!index ? null : !sel ? (
          <div className="cv-empty">
            <Icon name="note" size={34} />
            <b>{t("cv.emptyTitle")}</b>
            <p>{t("cv.emptyText")}</p>
            <div className="cv-empty-actions">
              <button className="btn primary" onClick={() => void create("note")}>
                <Icon name="note" size={16} /> {t("cv.newPage")}
              </button>
              <button className="btn" onClick={() => void create("table")}>
                <Icon name="table" size={16} /> {t("cv.newTable")}
              </button>
            </div>
          </div>
        ) : menu === "history" && sel.kind !== "chart" ? (
          <History base={base} sel={sel} onRestore={async (id) => (await edit({ op: "restore", id })) && (setMenu(""), refresh())} />
        ) : sel.kind === "note" ? (
          <NotePage key={key(sel)} base={base} name={sel.name} tick={tick} edit={edit} editing={editing} />
        ) : sel.kind === "table" ? (
          <TablePage key={key(sel)} base={base} name={sel.name} tick={tick} edit={edit} editing={editing} ask={ask} chartOpen={menu === "chart"} onChart={(name) => (setMenu(""), setSel({ kind: "chart", name }), refresh())} onChanged={() => void loadIndex()} />
        ) : (
          <ChartPage key={key(sel)} base={base} name={sel.name} tick={tick} onOpenTable={(name) => setSel({ kind: "table", name })} />
        )}
      </div>
    </aside>
  );
}

// ---------- a notes page (plans, drafts, reports) ----------

function NotePage({ base, name, tick, edit, editing }: { base: string; name: string; tick: number; edit: (b: Record<string, unknown>) => Promise<boolean>; editing: React.MutableRefObject<boolean> }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [write, setWrite] = useState(false);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");

  useEffect(() => {
    if (editing.current) return;
    let alive = true;
    api<{ text: string }>(`${base}?note=${enc(name)}`)
      .then((r) => alive && (setText(r.text), (latest.current = r.text)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [base, name, tick, editing]);

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (await edit({ op: "note", name, text: latest.current })) setSaved(true);
    editing.current = false;
  }, [edit, name, editing]);
  // Leaving the page with unsaved words: save them.
  useEffect(
    () => () => {
      if (timer.current) void save();
    },
    [save],
  );

  if (text === null) return null;
  // An empty page opens ready to write.
  const writing = write || !text.trim();
  return (
    <div className="cv-note">
      <div className="seg cv-seg" role="group" aria-label={t("cv.mode")}>
        <button className={!writing ? "on" : undefined} onClick={() => (setWrite(false), void save())} disabled={!text.trim()}>
          {t("cv.read")}
        </button>
        <button className={writing ? "on" : undefined} onClick={() => setWrite(true)}>
          {t("cv.write")}
        </button>
        <span className="cv-saved">{saved ? "" : t("cv.saving")}</span>
      </div>
      {writing ? (
        <textarea
          className="cv-text"
          dir="auto"
          value={text}
          placeholder={t("cv.notePlaceholder")}
          spellCheck
          onChange={(e) => {
            setText(e.target.value);
            latest.current = e.target.value;
            editing.current = true;
            setSaved(false);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void save(), 900);
          }}
          onBlur={() => timer.current && void save()}
        />
      ) : (
        <PageView
          text={text}
          onToggle={(line) => {
            const next = toggleBox(text, line);
            if (next === text) return;
            setText(next);
            latest.current = next;
            void edit({ op: "note", name, text: next });
          }}
        />
      )}
    </div>
  );
}

// ---------- a table page ----------

function TablePage({ base, name, tick, edit, editing, ask, chartOpen, onChart, onChanged }: { base: string; name: string; tick: number; edit: (b: Record<string, unknown>) => Promise<boolean>; editing: React.MutableRefObject<boolean>; ask: (label: string, value: string, ok: (v: string) => void) => void; chartOpen: boolean; onChart: (name: string) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<TableData | null>(null);
  const [cell, setCell] = useState<{ r: number; c: number; v: string } | null>(null);
  const [shown, setShown] = useState(200);

  const load = useCallback(async () => {
    try {
      // Pages of 200 rows, as many as the user asked to see.
      let rows: string[][] = [];
      let first: TableData | null = null;
      for (let from = 0; from < shown; from += 200) {
        const r = await api<TableData>(`${base}?table=${enc(name)}&from=${from}`);
        first ??= r;
        rows = rows.concat(r.rows);
        if (rows.length >= r.total) break;
      }
      if (first) setData({ ...first, rows });
    } catch {
      /* deleted meanwhile: the list refresh picks another page */
    }
  }, [base, name, shown]);
  useEffect(() => {
    if (!editing.current) void load();
  }, [load, tick, editing]);

  const change = async (body: Record<string, unknown>) => {
    if (await edit({ table: name, ...body })) {
      await load();
      onChanged();
    }
  };
  const commit = async () => {
    const c = cell;
    setCell(null);
    editing.current = false;
    if (!c || !data || (data.rows[c.r]?.[c.c] ?? "") === c.v) return;
    // Shown at once; the server's answer follows.
    setData({ ...data, rows: data.rows.map((row, i) => (i === c.r ? row.map((v, j) => (j === c.c ? c.v : v)) : row)) });
    await change({ op: "cell", row: c.r, col: c.c, value: c.v });
  };

  if (!data) return null;
  return (
    <div className="cv-table-page">
      {chartOpen && <ChartMaker columns={data.columns} rows={data.rows} onMake={async (c) => (await edit({ op: "chart", table: name, ...c })) && onChart(c.title)} />}
      <div className="cv-grid-wrap">
        <table className="cv-grid">
          <thead>
            <tr>
              <th className="cv-num" aria-label={t("cv.rowNumber")} />
              {data.columns.map((c, j) => (
                <th key={j} dir="auto">
                  <button
                    className="cv-col"
                    title={t("cv.renameColumn")}
                    onClick={() => ask(t("cv.renameColumn"), c, (to) => to !== c && void change({ op: "renameColumn", col: j, name: to }))}
                  >
                    {c}
                  </button>
                  {data.columns.length > 1 && (
                    <button className="cv-x" title={t("cv.removeColumn")} aria-label={t("cv.removeColumn")} onClick={() => window.confirm(t("cv.removeColumnConfirm", { name: c })) && void change({ op: "removeColumn", col: j })}>
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </th>
              ))}
              <th className="cv-add-col">
                <button
                  className="icon-btn sm"
                  title={t("cv.addColumn")}
                  aria-label={t("cv.addColumn")}
                  onClick={() => ask(t("cv.addColumn"), "", (n) => void change({ op: "addColumn", name: n }))}
                >
                  <Icon name="plus" size={14} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i}>
                <td className="cv-num">
                  <span>{i + 1}</span>
                  <button className="cv-x" title={t("cv.removeRow")} aria-label={t("cv.removeRow")} onClick={() => void change({ op: "removeRow", row: i })}>
                    <Icon name="close" size={12} />
                  </button>
                </td>
                {data.columns.map((_, j) => {
                  const v = row[j] ?? "";
                  const on = cell?.r === i && cell.c === j;
                  return (
                    <td key={j} dir="auto" className={on ? "on" : undefined} onClick={() => !on && ((editing.current = true), setCell({ r: i, c: j, v }))}>
                      {on ? (
                        <textarea
                          autoFocus
                          rows={1}
                          dir="auto"
                          value={cell.v}
                          onChange={(e) => setCell({ ...cell, v: e.target.value })}
                          onBlur={() => void commit()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), void commit());
                            if (e.key === "Escape") (setCell(null), (editing.current = false));
                          }}
                        />
                      ) : /^https?:\/\/\S+$/.test(v) ? (
                        <a href={v} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                          {v.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
                        </a>
                      ) : (
                        v
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cv-foot">
        <button className="btn sm" onClick={() => void change({ op: "addRow" })}>
          <Icon name="plus" size={14} /> {t("cv.addRow")}
        </button>
        <span className="cv-count">{t("cv.rows", { n: data.total })}</span>
        {data.rows.length < data.total && (
          <button className="btn sm" onClick={() => setShown(shown + 400)}>
            {t("cv.showMore")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Pick what to plot: the chart is saved as its own page and follows the table. */
function ChartMaker({ columns, rows, onMake }: { columns: string[]; rows: string[][]; onMake: (c: { type: ChartType; x: string; y: string[]; title: string }) => void }) {
  const { t } = useI18n();
  const nums = numericColumns({ columns, rows, updatedAt: 0 });
  const [type, setType] = useState<ChartType>("column");
  const [x, setX] = useState(columns.find((c) => !nums.includes(c)) ?? columns[0] ?? "");
  const [y, setY] = useState<string[]>(nums.slice(0, 1));
  if (!nums.length) return <p className="cv-msg">{t("cv.noNumbers")}</p>;
  return (
    <div className="cv-maker">
      <label>
        {t("cv.chartType")}
        <select value={type} onChange={(e) => setType(e.target.value as ChartType)}>
          {CHART_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`cv.type.${k}` as "cv.type.column")}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("cv.chartX")}
        <select value={x} onChange={(e) => setX(e.target.value)}>
          {columns.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>{t("cv.chartY")}</legend>
        {nums.map((c) => (
          <label key={c} className="cv-check">
            <input type="checkbox" checked={y.includes(c)} onChange={(e) => setY(e.target.checked ? [...y, c] : y.filter((v) => v !== c))} /> {c}
          </label>
        ))}
      </fieldset>
      <button className="btn sm primary" disabled={!y.length} onClick={() => onMake({ type, x, y, title: `${y.join(", ")} / ${x}`.slice(0, 60) })}>
        {t("cv.chartMake")}
      </button>
    </div>
  );
}

// ---------- a chart page ----------

function ChartPage({ base, name, tick, onOpenTable }: { base: string; name: string; tick: number; onOpenTable: (name: string) => void }) {
  const { t } = useI18n();
  const [c, setC] = useState<ChartPayload | null>(null);
  useEffect(() => {
    let alive = true;
    api<ChartPayload>(`${base}?chart=${enc(name)}`)
      .then((r) => alive && setC(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [base, name, tick]);
  if (!c) return null;
  return (
    <div className="cv-chart-page">
      <ChartView type={c.chart.type} data={c.data} title={c.chart.title} />
      <p className="cv-from">
        {t("cv.chartFrom")}{" "}
        <button className="cv-link" onClick={() => onOpenTable(c.chart.table)} dir="auto">
          {c.chart.table}
        </button>
        . {t("cv.chartFollows")}
      </p>
    </div>
  );
}

// ---------- earlier versions ----------

function History({ base, sel, onRestore }: { base: string; sel: Sel; onRestore: (id: string) => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<Version[] | null>(null);
  useEffect(() => {
    api<{ history: Version[] }>(`${base}?history=1&kind=${sel.kind}&name=${enc(sel.name)}`)
      .then((r) => setList(r.history))
      .catch(() => setList([]));
  }, [base, sel.kind, sel.name]);
  if (!list) return null;
  return (
    <div className="cv-history">
      <b>{t("cv.history")}</b>
      <p className="cv-hint">{t("cv.historyHint")}</p>
      {list.length === 0 ? (
        <p className="cv-hint">{t("cv.historyEmpty")}</p>
      ) : (
        <ul>
          {list.map((v) => (
            <li key={v.id}>
              <span>
                {new Date(v.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                <small>{v.size}</small>
              </span>
              <button className="btn sm" onClick={() => window.confirm(t("cv.restoreConfirm")) && onRestore(v.id)}>
                {t("cv.restore")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
