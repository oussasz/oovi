"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, botMood, entryMood, fmtCost, fmtTokens, readEvents, refreshSidebar, timeLabel } from "@/lib/client";
import { FACE_COLORS } from "@/lib/faces";
import { HOSTED_NAME, PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import { HostedNotice, refreshCredits } from "./Credits";
import type { PublicSettings } from "@/lib/settings";
import "@/lib/desktop";
import type { Bot, BotEntry, ChatEvent, ChatWithState, Effort, ToolCall, ToolResult } from "@/lib/types";
import Face, { FaceStack } from "./Face";
import type { TKey, Vars } from "@/lib/i18n";
import { useI18n } from "./I18n";
import Icon, { type IconName } from "./Icon";
import ProjectFolder from "./ProjectFolder";
import Rich from "./Rich";

type Shot = { img: string; url: string; botId: string; label: string };
type Row = { call: ToolCall; result?: ToolResult };
type TFn = (key: TKey, vars?: Vars) => string;

const host = (u: unknown) => {
  try {
    return new URL(String(u)).host.replace(/^www\./, "");
  } catch {
    return String(u ?? "");
  }
};

function callLabel(c: ToolCall, t: TFn): string {
  const i = c.input;
  switch (c.name) {
    case "web_search": return t("chat.call.search", { query: String(i.query ?? "") });
    case "open_url": return t("chat.call.open", { host: host(i.url) });
    case "read_page": return t("chat.call.read");
    case "click": return t("chat.call.click", { element: String(i.element) });
    case "type": return t(i.submit ? "chat.call.typeEnter" : "chat.call.type", { text: String(i.text ?? "") });
    case "go_back": return t("chat.call.back");
    case "research": return t("chat.call.research", { query: String(i.question ?? "") });
    case "read_url": return t("chat.call.readUrl", { host: host(i.url) });
    case "create_document":
    case "create_spreadsheet":
    case "create_presentation": return t("chat.call.createFile", { name: String(i.filename ?? "") });
    case "read_document":
    case "read_file": return t("chat.call.readFile", { name: String(i.path ?? "") });
    case "list_files": return t("chat.call.listFiles");
    case "search_files": return t("chat.call.searchFiles", { query: String(i.query ?? "") });
    case "write_file":
    case "edit_file": return t("chat.call.editFile", { name: String(i.path ?? "") });
    case "delete_file": return t("chat.call.deleteFile", { name: String(i.path ?? "") });
    case "run_command": return t("chat.call.runCommand", { command: String(i.command ?? "").slice(0, 80) });
    case "vm_run": return t("chat.call.vmRun", { command: String(i.command ?? "").slice(0, 80) });
    case "vm_write_file":
    case "vm_read_file": return t("chat.call.vmFile", { name: String(i.path ?? "") });
    case "vm_download": return t("chat.call.vmDownload", { name: String(i.filename ?? i.path ?? "") });
    case "vm_public_url": return t("chat.call.vmUrl", { port: String(i.port ?? "") });
    case "message_group": return t("chat.call.messageGroup", { group: String(i.group ?? "") });
    case "list_groups":
    case "read_group": return t("chat.call.checkGroups");
    case "memory": return t("chat.call.memory");
    case "use_skill": return t("chat.call.useSkill", { name: String(i.name ?? "") });
    case "save_skill": return t("chat.call.saveSkill", { name: String(i.name ?? "") });
    default: return c.name.startsWith("mcp_") ? c.name.replace(/^mcp_/, "").replace(/_/g, " ") : c.name.replace(/_/g, " ");
  }
}

const callIcon = (c: ToolCall): IconName =>
  ["web_search", "research", "read_url"].includes(c.name)
    ? "globe"
    : c.name === "click" || c.name === "type"
      ? "cursor"
      : c.name.startsWith("create_") || c.name.endsWith("_file") || c.name.endsWith("_files") || c.name === "read_document"
        ? "folder"
        : c.name.startsWith("vm_")
          ? "server"
          : c.name === "run_command"
          ? "cpu"
          : "arrow";

function rowsOf(e: BotEntry): Row[] {
  const results = new Map<string, ToolResult>();
  for (const s of e.steps) if (s.role === "tool") for (const r of s.results) results.set(r.id, r);
  const rows: Row[] = [];
  for (const s of e.steps) if (s.role === "assistant") for (const c of s.toolCalls) rows.push({ call: c, result: results.get(c.id) });
  return rows;
}

const urlOf = (r?: ToolResult) => r?.content.match(/^URL: (.*)$/m)?.[1] ?? "";

// ---------- one bot reply ----------

const FILE_KIND: Record<string, string> = { docx: "Word", doc: "Word", xlsx: "Excel", xls: "Excel", csv: "CSV", pptx: "PowerPoint", pdf: "PDF", md: "Markdown", html: "Web page", txt: "Text" };

const EFFORTS: Effort[] = ["auto", "low", "medium", "high", "max"];

/** How hard the bots think for the next message, like Claude's effort setting. */
function EffortMenu({ value, onChange }: { value: Effort; onChange: (e: Effort) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="effort" ref={ref}>
      <button type="button" className={`chip${value !== "auto" ? " on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} title={t("chat.effortTitle")}>
        <Icon name="cpu" size={14} /> {value === "auto" ? t("chat.effort") : t(`chat.effort.${value}`)}
      </button>
      {open && (
        <div className="effort-pop" role="listbox" aria-label={t("chat.effortTitle")}>
          {EFFORTS.map((e) => (
            <button
              key={e}
              type="button"
              role="option"
              aria-selected={value === e}
              className={value === e ? "on" : ""}
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
            >
              <b>{t(`chat.effort.${e}`)}</b>
              <small>{t(`chat.effort.${e}.hint`)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A file a bot made, with buttons to open it in its normal app or show it in its folder. */
function FileCard({ file }: { file: NonNullable<ToolResult["file"]> }) {
  const { t } = useI18n();
  const [err, setErr] = useState<string | null>(null);
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const bridge = typeof window !== "undefined" ? window.oovi : undefined;
  const size = file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(file.size / 1024))} KB`;
  return (
    <div className={`file-card ext-${ext}`}>
      <span className="file-badge" aria-hidden>
        {ext.toUpperCase().slice(0, 4)}
      </span>
      <div className="file-main">
        <b title={file.path}>{file.name}</b>
        <small>
          {FILE_KIND[ext] ?? ext.toUpperCase()} · {size}
        </small>
        {err && <small className="msg-err">{err}</small>}
      </div>
      {bridge?.openFile ? (
        <div className="file-actions">
          <button className="btn sm primary" onClick={() => void bridge.openFile!(file.path).then((r) => setErr(r || null))}>
            {t("chat.openFile")}
          </button>
          <button className="btn sm" onClick={() => void bridge.showFile?.(file.path)}>
            {t("chat.showInFolder")}
          </button>
        </div>
      ) : (
        <code className="file-path">{file.path}</code>
      )}
    </div>
  );
}

/** Thumbs up/down and what the bots learned from a reply (self-learning). */
function ReplyActions({ e, chatId, onUpdate }: { e: BotEntry; chatId: string; onUpdate: (e: BotEntry) => void }) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr("");
    // Show the rating right away; learning from it can take a few seconds.
    if ("rating" in body) {
      const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
      onUpdate({ ...e, feedback: rating ? { rating, at: Date.now() } : undefined });
      setAsking(false);
    }
    try {
      const r = await api<{ entry: BotEntry }>(`/api/chats/${chatId}/learn`, { method: "POST", body: JSON.stringify({ entryId: e.id, ...body }) });
      onUpdate(r.entry);
      setAsking(false);
      setNote("");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rating = e.feedback?.rating;
  const l = e.learned;
  return (
    <>
      {l && (l.lessons.length > 0 || l.user.length > 0 || l.skill) && (
        <div className="learned">
          <div className="learned-head">
            <Icon name="bulb" size={14} /> {t("chat.learned")}
          </div>
          {l.lessons.length > 0 && (
            <ul>
              {l.lessons.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
          {l.user.length > 0 && (
            <p>
              <b>{t("chat.learnedUser")}:</b> {l.user.join(" · ")}
            </p>
          )}
          {l.skill &&
            (l.skillSaved ? (
              <span className="tag ok">{t("chat.skillSaved")}</span>
            ) : (
              <button type="button" className="btn sm" disabled={busy} title={l.skill.description} onClick={() => void send({ saveSkill: true })}>
                {t("chat.saveSkill", { name: l.skill.name })}
              </button>
            ))}
        </div>
      )}
      <div className="msg-actions">
        <button type="button" className={`icon-btn${rating === "up" ? " on" : ""}`} aria-pressed={rating === "up"} title={t("chat.good")} aria-label={t("chat.good")} disabled={busy} onClick={() => void send({ rating: rating === "up" ? null : "up" })}>
          <Icon name="thumbUp" size={15} />
        </button>
        <button
          type="button"
          className={`icon-btn${rating === "down" ? " on" : ""}`}
          aria-pressed={rating === "down"}
          title={t("chat.bad")}
          aria-label={t("chat.bad")}
          disabled={busy}
          onClick={() => (rating === "down" ? void send({ rating: null }) : setAsking(!asking))}
        >
          <Icon name="thumbDown" size={15} />
        </button>
        {busy && <span className="hint">{t("chat.learning")}</span>}
        {!busy && rating && !asking && <span className="hint">{t("chat.thanks")}</span>}
      </div>
      {asking && (
        <form
          className="fb-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            void send({ rating: "down", note });
          }}
        >
          <textarea rows={2} value={note} maxLength={600} autoFocus onChange={(ev) => setNote(ev.target.value)} placeholder={t("chat.badPh")} />
          <div className="row-btns">
            <button className="btn sm primary" disabled={busy}>
              {t("chat.badSend")}
            </button>
            <button type="button" className="btn sm" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
      {err && <div className="notice error small">{err}</div>}
    </>
  );
}

function BotMessage(props: { e: BotEntry; bot?: Bot; isLast: boolean; status?: string; bots: Bot[]; onShot: (s: Shot) => void; isLeader?: boolean; chatId: string; onUpdate: (e: BotEntry) => void }) {
  const { e, bot, isLast, status, bots, onShot, isLeader, chatId, onUpdate } = props;
  const rows = rowsOf(e);
  const running = e.status === "running";
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const collapsed = !running && rows.length > 3 && !showAll;
  const tokens = e.usage.input + e.usage.output;
  const files = rows.map((r) => r.result?.file).filter((f): f is NonNullable<ToolResult["file"]> => !!f);
  const thinking = e.steps
    .map((s) => (s.role === "assistant" ? (s.reasoning ?? "") : ""))
    .filter(Boolean)
    .join("\n\n");
  const { t, tag } = useI18n();
  const name = bot?.name ?? t("chat.deletedBot");

  const toggle = (r: Row) => {
    const next = new Set(open);
    if (next.has(r.call.id)) next.delete(r.call.id);
    else next.add(r.call.id);
    setOpen(next);
    if (r.result?.image) onShot({ img: r.result.image, url: urlOf(r.result), botId: e.botId, label: callLabel(r.call, t) });
  };

  return (
    <div className="msg bot">
      <div className="msg-face">{bot && <Face face={bot.face} mood={entryMood(e, isLast)} size={38} title={name} />}</div>
      <div className="msg-main">
        <div className="msg-meta">
          <b>{name}</b>
          {isLeader && <span className="lead-badge">{t("chat.leader")}</span>}
          {bot?.role && <span className="role" style={{ background: FACE_COLORS[bot.face.color] }}>{bot.role}</span>}
          <span>{timeLabel(e.at, tag)}</span>
          {tokens > 0 && <span title={t("chat.tokensTitle", { input: e.usage.input, output: e.usage.output })}>{t("chat.tokens", { n: fmtTokens(tokens, tag) })}</span>}
          {typeof e.credits === "number" ? (
            <span className="cost" title={t("chat.creditsTitle")}>
              {t("chat.credits", { n: e.credits < 10 ? e.credits.toFixed(1) : Math.round(e.credits) })}
            </span>
          ) : (
            typeof e.cost === "number" &&
            tokens > 0 && (
              <span className="cost" title={t("chat.costTitle")}>
                {fmtCost(e.cost, t("common.free"))}
              </span>
            )
          )}
          {e.model && (
            <span className={`model-badge${e.fallback ? " fb" : ""}`} title={e.fallback ? t("chat.fallbackTitle") : t("chat.modelTitle")}>
              {e.fallback ? t("chat.backup") : ""}
              {e.model}
            </span>
          )}
        </div>

        {e.note && <div className="msg-note">{e.note}</div>}
        {e.plan && e.plan.length > 0 && (
          <ol className="plan" aria-label={t("chat.plan")}>
            {e.plan.map((p, i) => (
              <li key={i} className={p.status}>
                <span className="plan-box" aria-hidden>
                  {p.status === "done" ? "✓" : p.status === "doing" ? "…" : ""}
                </span>
                {p.text}
              </li>
            ))}
          </ol>
        )}
        {thinking && (
          <details className="thinking">
            <summary>{t("chat.thoughts")}</summary>
            <div>{thinking}</div>
          </details>
        )}
        {rows.length > 0 && (
          <div className="steps">
            {collapsed ? (
              <button className="step-row summary" onClick={() => setShowAll(true)}>
                <span className="dot ok" />
                <span className="step-label">
                  {t("chat.steps", { count: rows.length, names: [...new Set(rows.map((r) => r.call.name))].map((n) => n.replace("_", " ")).join(", ") })}
                </span>
                <span className="step-more">{t("chat.show")}</span>
              </button>
            ) : (
              rows.map((r) => {
                const state = !r.result ? "run" : r.result.isError ? "err" : "ok";
                return (
                  <div key={r.call.id} className="step">
                    <button className="step-row" onClick={() => toggle(r)} aria-expanded={open.has(r.call.id)}>
                      <span className={`dot ${state}`} />
                      <Icon name={callIcon(r.call)} size={14} className="step-icon" />
                      <span className="step-label">{callLabel(r.call, t)}</span>
                      {r.result?.image && <Icon name="panel" size={14} className="step-icon" />}
                    </button>
                    {open.has(r.call.id) && r.result && <pre className="step-out">{r.result.content}</pre>}
                  </div>
                );
              })
            )}
          </div>
        )}

        {files.length > 0 && (
          <div className="file-cards">
            {files.map((f) => (
              <FileCard key={f.path} file={f} />
            ))}
          </div>
        )}
        {e.text && (
          <div className="bubble bot-bubble">
            <Rich text={e.text} bots={bots} />
          </div>
        )}
        {running && (
          <div className="typing" aria-live="polite">
            <i />
            <i />
            <i />
            <span>{status ?? t("chat.thinking")}</span>
          </div>
        )}
        {e.status === "waiting" && <div className="note">{t("chat.waiting")}</div>}
        {e.status === "stopped" && !e.text && <div className="note">{t("chat.stopped")}</div>}
        {e.status === "done" && !e.text && <div className="note">{t("chat.noReply")}</div>}
        {e.error && (e.errorCode && e.errorCode !== "busy" && e.errorCode !== "bad_request" ? <HostedNotice code={e.errorCode} message={e.error} /> : <div className="notice error small">{e.error}</div>)}
        {e.handoff && e.handoff.length > 0 && (
          <div className="handoff">
            <Icon name="arrow" size={14} /> {t("chat.passedTo")}
            {e.handoff.map((id) => {
              const b = bots.find((x) => x.id === id);
              return b ? (
                <span key={id} className="handoff-chip">
                  <Face face={b.face} size={18} /> {b.name}
                </span>
              ) : null;
            })}
          </div>
        )}
        {e.status === "done" && !!e.text && <ReplyActions e={e} chatId={chatId} onUpdate={onUpdate} />}
      </div>
    </div>
  );
}

// ---------- the chat ----------

/** Full-screen view of a bot's browser: zoom with the buttons, mouse wheel or +/-, drag to pan. Updates live. */
function ScreenZoom({ src, title, url, onClose }: { src: string; title: string; url: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const { t, num } = useI18n();
  const zoom = (d: number) => setScale((s) => Math.min(5, Math.max(1, Math.round((s + d) * 4) / 4)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") zoom(0.5);
      if (e.key === "-") zoom(-0.5);
      if (e.key === "0") {
        setScale(1);
        setPos({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (scale === 1) setPos({ x: 0, y: 0 });
  }, [scale]);

  return (
    <div className="zoom-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={t("chat.botScreen")}>
      <div className="zoom-bar">
        <span className="zoom-title">{title}</span>
        {url && <span className="zoom-url">{url}</span>}
        <span className="spacer" />
        <button className="icon-btn" onClick={() => zoom(-0.5)} disabled={scale <= 1} aria-label={t("chat.zoomOut")} title={t("chat.zoomOutTitle")}>
          <Icon name="zoomOut" />
        </button>
        <span className="zoom-level">{num(scale, { style: "percent", maximumFractionDigits: 0 })}</span>
        <button className="icon-btn" onClick={() => zoom(0.5)} disabled={scale >= 5} aria-label={t("chat.zoomIn")} title={t("chat.zoomInTitle")}>
          <Icon name="zoomIn" />
        </button>
        <button className="icon-btn" onClick={onClose} aria-label={t("common.close")} title={t("common.closeEsc")}>
          <Icon name="close" />
        </button>
      </div>
      <div
        className={`zoom-stage${scale > 1 ? " can-pan" : ""}`}
        onWheel={(e) => zoom(e.deltaY < 0 ? 0.25 : -0.25)}
        onPointerDown={(e) => {
          if (scale === 1) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
        }}
        onPointerMove={(e) => drag.current && setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y })}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => (scale === 1 ? setScale(2) : setScale(1))}
      >
        <img src={src} alt={title} draggable={false} style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }} />
      </div>
    </div>
  );
}

export default function ChatView({ id }: { id: string }) {
  const [chat, setChat] = useState<ChatWithState | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [missing, setMissing] = useState(false);
  const [running, setRunning] = useState(false);
  const [effort, setEffort] = useState<Effort>("auto");
  const [deep, setDeep] = useState(false);
  useEffect(() => {
    try {
      const e = localStorage.getItem("oovi.effort") as Effort | null;
      if (e && EFFORTS.includes(e)) setEffort(e);
      setDeep(localStorage.getItem(`oovi.deep.${id}`) === "1");
    } catch {
      /* storage unavailable */
    }
  }, [id]);
  const pickEffort = (e: Effort) => {
    setEffort(e);
    try {
      localStorage.setItem("oovi.effort", e);
    } catch {
      /* storage unavailable */
    }
  };
  const pickDeep = (on: boolean) => {
    setDeep(on);
    try {
      localStorage.setItem(`oovi.deep.${id}`, on ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<Shot | null>(null);
  const [showLive, setShowLive] = useState(true);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const { t, rich, list } = useI18n();

  const reload = useCallback(async () => {
    setChat(await api<ChatWithState>(`/api/chats/${id}`));
  }, [id]);

  const apply = useCallback((ev: ChatEvent) => {
    if (ev.type === "entry") {
      setChat((c) => {
        if (!c) return c;
        const entries = [...c.entries];
        const i = entries.findIndex((x) => x.id === ev.entry.id);
        if (i >= 0) entries[i] = ev.entry;
        else entries.push(ev.entry);
        return { ...c, entries };
      });
    } else if (ev.type === "status") setStatus((s) => ({ ...s, [ev.entryId]: ev.text }));
    else if (ev.type === "approval") setChat((c) => c && { ...c, pending: { ...(c.pending ?? { queue: [], turnsLeft: 0 }), approval: ev.approval } });
    else if (ev.type === "error") setError(ev.error);
  }, []);

  /** POST starts a run, GET re-attaches to one; both stream events. */
  const stream = useCallback(
    async (init?: RequestInit) => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setRunning(true);
      try {
        const res = await fetch(`/api/chats/${id}/run`, { ...init, signal: ctrl.signal });
        await readEvents(res, apply);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (ctrlRef.current === ctrl) {
          setRunning(false);
          setStatus({});
          try {
            await reload();
          } catch {
            /* chat may have been deleted */
          }
          refreshSidebar();
          refreshCredits();
        }
      }
    },
    [id, apply, reload],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, b, s] = await Promise.all([api<ChatWithState>(`/api/chats/${id}`), api<Bot[]>("/api/bots"), api<PublicSettings>("/api/settings")]);
        if (!alive) return;
        setChat(c);
        setBots(b);
        setSettings(s);
        try {
          setShowLive(localStorage.getItem("oovi.live") !== "0");
        } catch {
          /* storage unavailable */
        }
        if (c.running) void stream();
      } catch {
        if (alive) setMissing(true);
      }
    })();
    return () => {
      alive = false;
      ctrlRef.current?.abort();
    };
  }, [id, stream]);

  // Pick up work that starts elsewhere: the main bot giving this group a task,
  // a group's report arriving in the main bot's chat, or a Telegram message.
  const updatedAt = chat?.updatedAt;
  useEffect(() => {
    if (running || missing) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      api<ChatWithState>(`/api/chats/${id}`)
        .then((c) => {
          if (c.running) void stream();
          else if (c.updatedAt !== updatedAt) setChat(c);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [id, running, missing, updatedAt, stream]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat?.entries, chat?.pending, status, error]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  const members = useMemo(() => (chat?.memberIds ?? []).map((m) => bots.find((b) => b.id === m)).filter((b): b is Bot => !!b), [chat, bots]);

  const latest = useMemo<Shot | null>(() => {
    if (!chat) return null;
    for (let i = chat.entries.length - 1; i >= 0; i--) {
      const e = chat.entries[i];
      if (e?.kind !== "bot") continue;
      const rows = rowsOf(e);
      for (let j = rows.length - 1; j >= 0; j--) {
        const r = rows[j];
        if (r?.result?.image) return { img: r.result.image, url: urlOf(r.result), botId: e.botId, label: callLabel(r.call, t) };
      }
    }
    return null;
  }, [chat, t]);

  const activity = useMemo(() => {
    const out: { botId: string; row: Row }[] = [];
    for (const e of chat?.entries ?? []) if (e.kind === "bot") for (const row of rowsOf(e)) out.push({ botId: e.botId, row });
    return out.slice(-12).reverse();
  }, [chat]);

  if (missing) {
    return (
      <div className="page center">
        <h1>{t("chat.notFound")}</h1>
        <p className="muted">{t("chat.notFoundSub")}</p>
        <Link className="btn" href="/">{t("chat.backHome")}</Link>
      </div>
    );
  }
  if (!chat || !settings) return <div className="page center muted">{t("common.loading")}</div>;

  const isGroup = chat.kind === "group";
  const solo = isGroup ? undefined : members[0];
  const lead = members.find((m) => m.id === chat.leadId) ?? members[0];
  const leaderMode = isGroup && chat.orchestrate !== false && members.length > 1;
  const approval = chat.pending?.approval;
  const approvalBot = approval ? bots.find((b) => b.id === approval.botId) : undefined;
  const shot = !running && picked ? picked : latest;
  const shotBot = shot ? bots.find((b) => b.id === shot.botId) : undefined;

  const providerOf = (b: Bot): ProviderId => b.provider ?? settings.active;
  const modelLabel = (b: Bot) => {
    if (settings.hosted) return HOSTED_NAME;
    const p = providerOf(b);
    return `${PROVIDERS[p].label.replace(/ \(.*\)$/, "")} · ${b.model || settings.providers[p]?.model || PROVIDERS[p].model || t("chat.modelUnknown")}`;
  };
  const missingKeys = settings.hosted ? [] : [...new Set(members.map(providerOf))].filter((p) => PROVIDERS[p].needsKey && !settings.providers[p]?.hasKey);

  const suggestions = mentionQ === null ? [] : members.filter((m) => m.name.toLowerCase().startsWith(mentionQ.toLowerCase()));

  const ideas: string[] = isGroup
    ? [
        members[1] ? t("chat.idea.findCompare", { a: members[0]?.name ?? "", b: members[1].name }) : t("chat.idea.find"),
        members[2] ? t("chat.idea.tripCheck", { c: members[2].name }) : t("chat.idea.trip"),
        t("chat.idea.intro"),
      ]
    : solo?.tools.web
      ? [t("chat.idea.news"), t("chat.idea.passwords"), t("chat.idea.whatCanYouDo")]
      : [t("chat.idea.email"), t("chat.idea.coffee"), t("chat.idea.whatCanYouDo")];

  function send(text: string) {
    const t = text.trim();
    if (!t || running) return;
    setInput("");
    setMentionQ(null);
    setError(null);
    setPicked(null);
    stick.current = true;
    void stream({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t, effort, deep }) });
  }

  /** alwaysEdit: also allow file edits in this chat's project folder from now on. */
  function decide(ok: boolean, alwaysEdit = false) {
    if (!approval) return;
    setError(null);
    void stream({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisions: Object.fromEntries(approval.items.map((i) => [i.call.id, ok])), alwaysEdit }) });
  }

  async function stop() {
    await fetch(`/api/chats/${id}/run`, { method: "DELETE" }).catch(() => {});
  }

  async function clear() {
    if (!confirm(t("chat.confirmClear"))) return;
    try {
      setChat(await api<ChatWithState>(`/api/chats/${id}`, { method: "PUT", body: JSON.stringify({ clear: true }) }));
      setPicked(null);
      refreshSidebar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function toggleLive() {
    const next = !showLive;
    setShowLive(next);
    try {
      localStorage.setItem("oovi.live", next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }

  function onInput(v: string) {
    setInput(v);
    const caret = taRef.current?.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/@([\p{L}\p{N}_-]*)$/u);
    setMentionQ(isGroup && m ? (m[1] ?? "") : null);
    setSel(0);
  }

  function pickMention(b: Bot) {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? input.length;
    const before = input.slice(0, caret).replace(/@([\p{L}\p{N}_-]*)$/u, `@${b.name} `);
    setInput(before + input.slice(caret));
    setMentionQ(null);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(before.length, before.length);
    });
  }

  function insertMention(b: Bot) {
    setInput((v) => `${v}${v && !v.endsWith(" ") ? " " : ""}@${b.name} `);
    taRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((sel + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((sel - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const b = suggestions[sel];
        if (b) pickMention(b);
        return;
      }
      if (e.key === "Escape") {
        setMentionQ(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className={`chatview${showLive ? " with-live" : ""}`}>
      <section className="chat-col">
        <header className="chat-head">
          {isGroup ? (
            <FaceStack faces={members.map((m) => m.face)} moods={members.map((m) => botMood(chat, m.id))} size={46} />
          ) : (
            solo && <Face face={solo.face} mood={botMood(chat, solo.id)} size={46} />
          )}
          <div className="chat-title">
            <h1>{isGroup ? chat.name : (solo?.name ?? t("common.bot"))}</h1>
            <p>
              {isGroup
                ? lead
                  ? t(leaderMode ? "chat.subLedBy" : "chat.subFirst", { members: members.map((m) => m.name).join(", "), name: lead.name })
                  : members.map((m) => m.name).join(", ") || t("chat.noBots")
                : solo && [solo.role, modelLabel(solo)].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="head-actions">
            <ProjectFolder chat={chat} running={running} onChange={(c) => setChat(c)} />
            <Link className="icon-btn" href={isGroup ? `/groups/${chat.id}` : `/bots/${solo?.id ?? ""}`} title={isGroup ? t("chat.editGroup") : t("chat.editBot")} aria-label={t("common.edit")}>
              <Icon name="edit" />
            </Link>
            <button className="icon-btn" onClick={clear} disabled={running || !chat.entries.length} title={t("chat.clear")} aria-label={t("chat.clear")}>
              <Icon name="broom" />
            </button>
            <button className={`icon-btn${showLive ? " on" : ""}`} onClick={toggleLive} title={t("chat.live")} aria-label={t("chat.toggleLive")} aria-pressed={showLive}>
              <Icon name="panel" />
            </button>
          </div>
        </header>

        <div
          className="thread"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
          }}
        >
          <div className="thread-inner">
            {missingKeys.length > 0 && (
              <div className="notice">
                {rich("chat.missingKeys", {
                  providers: list(missingKeys.map((p) => PROVIDERS[p].label)),
                  settings: <Link href="/settings">{t("common.settings")}</Link>,
                  who: isGroup ? t("chat.theBots") : (solo?.name ?? ""),
                })}
              </div>
            )}

            {chat.entries.length === 0 && (
              <div className="empty">
                <div className="empty-faces">
                  {members.slice(0, 5).map((m, i) => (
                    <Face key={m.id} face={m.face} mood={i === 0 ? "happy" : "idle"} size={isGroup ? 72 : 112} interactive />
                  ))}
                </div>
                <h2>{isGroup ? t("chat.sayHi", { name: chat.name }) : t("chat.hiIm", { name: solo?.name ?? "" })}</h2>
                <p>
                  {isGroup
                    ? leaderMode
                      ? t("chat.leaderIntro", { name: lead?.name ?? t("chat.theLeader") })
                      : t("chat.leadIntro", { name: lead?.name ?? t("chat.theLead") })
                    : solo?.instructions || t("chat.askAnything")}
                </p>
                <div className="ideas">
                  {ideas.map((s) => (
                    <button key={s} className="idea" onClick={() => send(s)} disabled={missingKeys.length > 0}>
                      <Rich text={s} bots={members} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chat.entries.map((e, i) =>
              e.kind === "user" ? (
                <div key={e.id} className={`msg user${e.via || e.deep || (e.effort && e.effort !== "auto") ? " via" : ""}`}>
                  {e.via && <div className="via-label">{t("chat.viaMain", { name: bots.find((b) => b.id === e.via)?.name ?? t("chat.aBot") })}</div>}
                  <div className="bubble user-bubble">
                    <Rich text={e.text} bots={members} />
                  </div>
                  {(e.deep || (e.effort && e.effort !== "auto")) && (
                    <div className="msg-mode">
                      {e.deep && <span>{t("chat.deep")}</span>}
                      {e.effort && e.effort !== "auto" && <span>{t(`chat.effort.${e.effort}`)}</span>}
                    </div>
                  )}
                </div>
              ) : (
                <BotMessage key={e.id} e={e} bot={bots.find((b) => b.id === e.botId)} isLast={i === chat.entries.length - 1} status={status[e.id]} bots={members} onShot={setPicked} isLeader={leaderMode && e.botId === lead?.id} chatId={id} onUpdate={(ne) => setChat((c) => c && { ...c, entries: c.entries.map((x) => (x.id === ne.id ? ne : x)) })} />
              ),
            )}

            {approval && !running && (
              <div className="approval" role="alert">
                {approvalBot && <Face face={approvalBot.face} mood="asking" size={44} />}
                <div>
                  <strong>{t("chat.wantsTo", { name: approvalBot?.name ?? t("chat.aBot") })}</strong>
                  <ul>
                    {approval.items.map((it) => (
                      <li key={it.call.id}>
                        {it.summary}
                        {it.detail && (
                          <details className="approval-detail" open={it.call.name === "run_command" || it.detail.length < 600}>
                            <summary>{t("chat.details")}</summary>
                            <pre>{it.detail}</pre>
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="row wrap">
                    <button className="btn primary" onClick={() => decide(true)}>
                      <Icon name="check" size={16} /> {approval.items.some((i) => i.always) ? t("chat.allowOnce") : t("chat.allow")}
                    </button>
                    {approval.items.some((i) => i.always) && (
                      <button className="btn" onClick={() => decide(true, true)}>{t("chat.alwaysEdits")}</button>
                    )}
                    <button className="btn" onClick={() => decide(false)}>{t("chat.deny")}</button>
                  </div>
                </div>
              </div>
            )}
            {error && <div className="notice error">{error}</div>}
          </div>
        </div>

        <div className="composer-wrap">
          {suggestions.length > 0 && (
            <div className="mention-pop" role="listbox" aria-label={t("chat.mentionABot")}>
              {suggestions.map((b, i) => (
                <button
                  key={b.id}
                  role="option"
                  aria-selected={i === sel}
                  className={i === sel ? "on" : ""}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    pickMention(b);
                  }}
                >
                  <Face face={b.face} size={24} /> <b>{b.name}</b> <span>{b.role}</span>
                </button>
              ))}
            </div>
          )}
          {isGroup && members.length > 0 && (
            <div className="mention-bar">
              {members.map((m) => (
                <button key={m.id} className="chip" onClick={() => insertMention(m)} title={t("chat.mention", { name: m.name })}>
                  <Face face={m.face} size={20} mood={botMood(chat, m.id)} /> {m.name}
                </button>
              ))}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => onInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={isGroup ? t("chat.placeholderGroup", { name: chat.name }) : t("chat.placeholderSolo", { name: solo?.name ?? t("chat.theBot") })}
              aria-label={t("chat.message")}
            />
            {running ? (
              <button type="button" className="send stop" onClick={stop} title={t("chat.stopTitle")} aria-label={t("chat.stop")}>
                <Icon name="stop" />
              </button>
            ) : (
              <button type="submit" className="send" disabled={!input.trim()} title={t("chat.send")} aria-label={t("chat.send")}>
                <Icon name="send" />
              </button>
            )}
          </form>
          <div className="composer-tools">
            <EffortMenu value={effort} onChange={pickEffort} />
            <button type="button" className={`chip deep-chip${deep ? " on" : ""}`} aria-pressed={deep} onClick={() => pickDeep(!deep)} title={t("chat.deepHint")}>
              <Icon name="spark" size={14} /> {t("chat.deep")}
            </button>
          </div>
        </div>
      </section>

      {showLive && (
        <aside className="live" aria-label={t("chat.live")}>
          <div className="live-head">
            <span>{t("chat.live")}</span>
            <button className="icon-btn sm" onClick={toggleLive} aria-label={t("chat.closeLive")}>
              <Icon name="close" size={16} />
            </button>
          </div>
          {shot ? (
            <div className="live-shot">
              <div className="live-who">
                {shotBot && <Face face={shotBot.face} size={26} mood={running ? "working" : "idle"} />}
                <div>
                  <b>{shotBot?.name ?? t("common.bot")}</b>
                  <span>{shot.label}</span>
                </div>
              </div>
              {shot.url && (
                <a className="live-url" href={shot.url} target="_blank" rel="noreferrer noopener">
                  {shot.url}
                </a>
              )}
              <button className="live-zoom-btn" onClick={() => setZoomOpen(true)} title={t("chat.openFull")} aria-label={t("chat.openFullAria")}>
                <img src={shot.img} alt={t("chat.shotAlt", { name: shotBot?.name ?? t("chat.theBot") })} />
                <span className="live-zoom-hint">
                  <Icon name="expand" size={14} /> {t("chat.zoom")}
                </span>
              </button>
              {zoomOpen && <ScreenZoom src={shot.img} title={`${shotBot?.name ?? t("common.bot")} · ${shot.label}`} url={shot.url} onClose={() => setZoomOpen(false)} />}
            </div>
          ) : (
            <div className="live-empty">
              {(members.find((m) => m.tools.browser) ?? members[0]) && <Face face={(members.find((m) => m.tools.browser) ?? members[0])!.face} size={60} />}
              <p>{t("chat.liveEmpty")}</p>
            </div>
          )}
          {activity.length > 0 && (
            <div className="live-activity">
              <div className="live-sub">{t("chat.recent")}</div>
              {activity.map(({ botId, row }) => {
                const b = bots.find((x) => x.id === botId);
                return (
                  <button
                    key={row.call.id}
                    className="act"
                    onClick={() => row.result?.image && setPicked({ img: row.result.image, url: urlOf(row.result), botId, label: callLabel(row.call, t) })}
                    disabled={!row.result?.image}
                  >
                    {b && <Face face={b.face} size={20} />}
                    <span>{callLabel(row.call, t)}</span>
                    <span className={`dot ${!row.result ? "run" : row.result.isError ? "err" : "ok"}`} />
                  </button>
                );
              })}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
