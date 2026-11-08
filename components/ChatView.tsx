"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, botMood, entryMood, fmtCost, fmtTokens, readEvents, refreshSidebar, timeLabel } from "@/lib/client";
import { FACE_COLORS } from "@/lib/faces";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import type { PublicSettings } from "@/lib/settings";
import type { Bot, BotEntry, ChatEvent, ChatWithState, ToolCall, ToolResult } from "@/lib/types";
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
    default: return c.name;
  }
}

const callIcon = (c: ToolCall): IconName => (c.name === "web_search" ? "globe" : c.name === "click" || c.name === "type" ? "cursor" : "arrow");

function rowsOf(e: BotEntry): Row[] {
  const results = new Map<string, ToolResult>();
  for (const s of e.steps) if (s.role === "tool") for (const r of s.results) results.set(r.id, r);
  const rows: Row[] = [];
  for (const s of e.steps) if (s.role === "assistant") for (const c of s.toolCalls) rows.push({ call: c, result: results.get(c.id) });
  return rows;
}

const urlOf = (r?: ToolResult) => r?.content.match(/^URL: (.*)$/m)?.[1] ?? "";

// ---------- one bot reply ----------

function BotMessage(props: { e: BotEntry; bot?: Bot; isLast: boolean; status?: string; bots: Bot[]; onShot: (s: Shot) => void; isLeader?: boolean }) {
  const { e, bot, isLast, status, bots, onShot, isLeader } = props;
  const rows = rowsOf(e);
  const running = e.status === "running";
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const collapsed = !running && rows.length > 3 && !showAll;
  const tokens = e.usage.input + e.usage.output;
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
          {typeof e.cost === "number" && tokens > 0 && (
            <span className="cost" title={t("chat.costTitle")}>
              {fmtCost(e.cost, t("common.free"))}
            </span>
          )}
          {e.model && (
            <span className={`model-badge${e.fallback ? " fb" : ""}`} title={e.fallback ? t("chat.fallbackTitle") : t("chat.modelTitle")}>
              {e.fallback ? t("chat.backup") : ""}
              {e.model}
            </span>
          )}
        </div>

        {e.note && <div className="msg-note">{e.note}</div>}
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
        {e.error && <div className="notice error small">{e.error}</div>}
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
        {e.handoffBlocked && <div className="note">{t("chat.handoffLimit")}</div>}
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
    const p = providerOf(b);
    return `${PROVIDERS[p].label.replace(/ \(.*\)$/, "")} · ${b.model || settings.providers[p]?.model || PROVIDERS[p].model || t("chat.modelUnknown")}`;
  };
  const missingKeys = [...new Set(members.map(providerOf))].filter((p) => PROVIDERS[p].needsKey && !settings.providers[p]?.hasKey);

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
    void stream({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
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
                <div key={e.id} className="msg user">
                  <div className="bubble user-bubble">
                    <Rich text={e.text} bots={members} />
                  </div>
                </div>
              ) : (
                <BotMessage key={e.id} e={e} bot={bots.find((b) => b.id === e.botId)} isLast={i === chat.entries.length - 1} status={status[e.id]} bots={members} onShot={setPicked} isLeader={leaderMode && e.botId === lead?.id} />
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
