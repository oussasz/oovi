"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, botMood, entryMood, fmtTokens, readEvents, refreshSidebar, timeLabel } from "@/lib/client";
import { FACE_COLORS } from "@/lib/faces";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import type { PublicSettings } from "@/lib/settings";
import type { Bot, BotEntry, ChatEvent, ChatWithState, ToolCall, ToolResult } from "@/lib/types";
import Face, { FaceStack } from "./Face";
import Icon, { type IconName } from "./Icon";
import Rich from "./Rich";

type Shot = { img: string; url: string; botId: string; label: string };
type Row = { call: ToolCall; result?: ToolResult };

const host = (u: unknown) => {
  try {
    return new URL(String(u)).host.replace(/^www\./, "");
  } catch {
    return String(u ?? "");
  }
};

function callLabel(c: ToolCall): string {
  const i = c.input;
  switch (c.name) {
    case "web_search": return `Searched “${String(i.query ?? "")}”`;
    case "open_url": return `Opened ${host(i.url)}`;
    case "read_page": return "Read more of the page";
    case "click": return `Clicked element ${String(i.element)}`;
    case "type": return `Typed “${String(i.text ?? "")}”${i.submit ? " + Enter" : ""}`;
    case "go_back": return "Went back";
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
  const name = bot?.name ?? "Deleted bot";

  const toggle = (r: Row) => {
    const next = new Set(open);
    if (next.has(r.call.id)) next.delete(r.call.id);
    else next.add(r.call.id);
    setOpen(next);
    if (r.result?.image) onShot({ img: r.result.image, url: urlOf(r.result), botId: e.botId, label: callLabel(r.call) });
  };

  return (
    <div className="msg bot">
      <div className="msg-face">{bot && <Face face={bot.face} mood={entryMood(e, isLast)} size={38} title={name} />}</div>
      <div className="msg-main">
        <div className="msg-meta">
          <b>{name}</b>
          {isLeader && <span className="lead-badge">leader</span>}
          {bot?.role && <span className="role" style={{ background: FACE_COLORS[bot.face.color] }}>{bot.role}</span>}
          <span>{timeLabel(e.at)}</span>
          {tokens > 0 && <span title={`${e.usage.input} in · ${e.usage.output} out`}>· {fmtTokens(tokens)} tokens</span>}
          {e.model && (
            <span className={`model-badge${e.fallback ? " fb" : ""}`} title={e.fallback ? "The bot's own model failed or was busy, so a backup model answered." : "Model that answered"}>
              {e.fallback ? "backup: " : ""}
              {e.model}
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <div className="steps">
            {collapsed ? (
              <button className="step-row summary" onClick={() => setShowAll(true)}>
                <span className="dot ok" />
                <span className="step-label">
                  {rows.length} steps · {[...new Set(rows.map((r) => r.call.name))].map((n) => n.replace("_", " ")).join(", ")}
                </span>
                <span className="step-more">Show</span>
              </button>
            ) : (
              rows.map((r) => {
                const state = !r.result ? "run" : r.result.isError ? "err" : "ok";
                return (
                  <div key={r.call.id} className="step">
                    <button className="step-row" onClick={() => toggle(r)} aria-expanded={open.has(r.call.id)}>
                      <span className={`dot ${state}`} />
                      <Icon name={callIcon(r.call)} size={14} className="step-icon" />
                      <span className="step-label">{callLabel(r.call)}</span>
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
            <span>{status ?? "Thinking…"}</span>
          </div>
        )}
        {e.status === "waiting" && <div className="note">Waiting for your OK…</div>}
        {e.status === "stopped" && !e.text && <div className="note">Stopped.</div>}
        {e.status === "done" && !e.text && <div className="note">(no reply)</div>}
        {e.error && <div className="notice error small">{e.error}</div>}
        {e.handoff && e.handoff.length > 0 && (
          <div className="handoff">
            <Icon name="arrow" size={14} /> Passed to
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
        {e.handoffBlocked && <div className="note">Hand-off limit reached for this message. @mention a bot to keep going.</div>}
      </div>
    </div>
  );
}

// ---------- the chat ----------

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
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ctrlRef = useRef<AbortController | null>(null);

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
        if (r?.result?.image) return { img: r.result.image, url: urlOf(r.result), botId: e.botId, label: callLabel(r.call) };
      }
    }
    return null;
  }, [chat]);

  const activity = useMemo(() => {
    const out: { botId: string; row: Row }[] = [];
    for (const e of chat?.entries ?? []) if (e.kind === "bot") for (const row of rowsOf(e)) out.push({ botId: e.botId, row });
    return out.slice(-12).reverse();
  }, [chat]);

  if (missing) {
    return (
      <div className="page center">
        <h1>Chat not found</h1>
        <p className="muted">It may have been deleted.</p>
        <Link className="btn" href="/">Back home</Link>
      </div>
    );
  }
  if (!chat || !settings) return <div className="page center muted">Loading…</div>;

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
    return `${PROVIDERS[p].label.replace(/ \(.*\)$/, "")} · ${b.model || settings.providers[p]?.model || PROVIDERS[p].model || "model?"}`;
  };
  const missingKeys = [...new Set(members.map(providerOf))].filter((p) => PROVIDERS[p].needsKey && !settings.providers[p]?.hasKey);

  const suggestions = mentionQ === null ? [] : members.filter((m) => m.name.toLowerCase().startsWith(mentionQ.toLowerCase()));

  const ideas: string[] = isGroup
    ? [
        members[1] ? `@${members[0]?.name} find the 3 best free note-taking apps, then ask @${members[1].name} to write a short comparison.` : "Find the 3 best free note-taking apps and compare them.",
        `Plan a 3-day trip to Istanbul on a budget.${members[2] ? ` @${members[2].name}, check the plan for problems.` : ""}`,
        "@everyone introduce yourselves in one line each.",
      ]
    : solo?.tools.web
      ? ["What's the biggest tech news today? Give sources.", "Compare the 3 most popular password managers.", "What can you do?"]
      : ["Help me write a friendly follow-up email.", "Give me 5 name ideas for a small coffee shop.", "What can you do?"];

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

  function decide(ok: boolean) {
    if (!approval) return;
    setError(null);
    void stream({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisions: Object.fromEntries(approval.items.map((i) => [i.call.id, ok])) }) });
  }

  async function stop() {
    await fetch(`/api/chats/${id}/run`, { method: "DELETE" }).catch(() => {});
  }

  async function clear() {
    if (!confirm("Clear this conversation? The bots and their settings stay.")) return;
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
            <h1>{isGroup ? chat.name : (solo?.name ?? "Bot")}</h1>
            <p>
              {isGroup
                ? `${members.map((m) => m.name).join(", ") || "No bots yet"}${lead ? (leaderMode ? ` · led by ${lead.name}` : ` · ${lead.name} answers first`) : ""}`
                : solo && [solo.role, modelLabel(solo)].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="head-actions">
            <Link className="icon-btn" href={isGroup ? `/groups/${chat.id}` : `/bots/${solo?.id ?? ""}`} title={isGroup ? "Edit group" : "Edit bot"} aria-label="Edit">
              <Icon name="edit" />
            </Link>
            <button className="icon-btn" onClick={clear} disabled={running || !chat.entries.length} title="Clear conversation" aria-label="Clear conversation">
              <Icon name="broom" />
            </button>
            <button className={`icon-btn${showLive ? " on" : ""}`} onClick={toggleLive} title="Live view" aria-label="Toggle live view" aria-pressed={showLive}>
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
                Add your {missingKeys.map((p) => PROVIDERS[p].label).join(" and ")} API key in <Link href="/settings">Settings</Link> to wake {isGroup ? "the bots" : solo?.name} up.
              </div>
            )}

            {chat.entries.length === 0 && (
              <div className="empty">
                <div className="empty-faces">
                  {members.slice(0, 5).map((m, i) => (
                    <Face key={m.id} face={m.face} mood={i === 0 ? "happy" : "idle"} size={isGroup ? 72 : 112} interactive />
                  ))}
                </div>
                <h2>{isGroup ? `Say hi to ${chat.name}` : `Hi, I'm ${solo?.name}`}</h2>
                <p>
                  {isGroup
                    ? leaderMode
                      ? `${lead?.name ?? "The leader"} leads this team: they plan, hand tasks to the others and give you one final answer. You can also @mention anyone directly.`
                      : `${lead?.name ?? "The lead"} answers first. @mention anyone to choose who answers, and bots @mention each other to hand off work.`
                    : solo?.instructions || "Ask me anything."}
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
                  <strong>{approvalBot?.name ?? "A bot"} wants to:</strong>
                  <ul>
                    {approval.items.map((it) => (
                      <li key={it.call.id}>{it.summary}</li>
                    ))}
                  </ul>
                  <div className="row">
                    <button className="btn primary" onClick={() => decide(true)}>
                      <Icon name="check" size={16} /> Allow
                    </button>
                    <button className="btn" onClick={() => decide(false)}>Deny</button>
                  </div>
                </div>
              </div>
            )}
            {error && <div className="notice error">{error}</div>}
          </div>
        </div>

        <div className="composer-wrap">
          {suggestions.length > 0 && (
            <div className="mention-pop" role="listbox" aria-label="Mention a bot">
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
                <button key={m.id} className="chip" onClick={() => insertMention(m)} title={`Mention ${m.name}`}>
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
              placeholder={isGroup ? `Message ${chat.name}. Type @ to pick a bot` : `Message ${solo?.name ?? "the bot"}`}
              aria-label="Message"
            />
            {running ? (
              <button type="button" className="send stop" onClick={stop} title="Stop the bots" aria-label="Stop">
                <Icon name="stop" />
              </button>
            ) : (
              <button type="submit" className="send" disabled={!input.trim()} title="Send" aria-label="Send">
                <Icon name="send" />
              </button>
            )}
          </form>
        </div>
      </section>

      {showLive && (
        <aside className="live" aria-label="Live view">
          <div className="live-head">
            <span>Live view</span>
            <button className="icon-btn sm" onClick={toggleLive} aria-label="Close live view">
              <Icon name="close" size={16} />
            </button>
          </div>
          {shot ? (
            <div className="live-shot">
              <div className="live-who">
                {shotBot && <Face face={shotBot.face} size={26} mood={running ? "working" : "idle"} />}
                <div>
                  <b>{shotBot?.name ?? "Bot"}</b>
                  <span>{shot.label}</span>
                </div>
              </div>
              {shot.url && (
                <a className="live-url" href={shot.url} target="_blank" rel="noreferrer noopener">
                  {shot.url}
                </a>
              )}
              <img src={shot.img} alt={`What ${shotBot?.name ?? "the bot"}'s browser shows`} />
            </div>
          ) : (
            <div className="live-empty">
              {(members.find((m) => m.tools.browser) ?? members[0]) && <Face face={(members.find((m) => m.tools.browser) ?? members[0])!.face} size={60} />}
              <p>When a bot opens a web page, you&apos;ll see its screen here.</p>
            </div>
          )}
          {activity.length > 0 && (
            <div className="live-activity">
              <div className="live-sub">Recent activity</div>
              {activity.map(({ botId, row }) => {
                const b = bots.find((x) => x.id === botId);
                return (
                  <button
                    key={row.call.id}
                    className="act"
                    onClick={() => row.result?.image && setPicked({ img: row.result.image, url: urlOf(row.result), botId, label: callLabel(row.call) })}
                    disabled={!row.result?.image}
                  >
                    {b && <Face face={b.face} size={20} />}
                    <span>{callLabel(row.call)}</span>
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
