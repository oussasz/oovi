"use client";

// Settings > Memory & soul: what the bots know about the user (USER.md), what the team
// learned (lessons.json + MEMORY.md), each bot's soul (Bot.instructions) and the user's
// reference knowledge (KNOWLEDGE.md). All of it lives in the account's data folder and
// only ever goes into the model prompt.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import type { Bot } from "@/lib/types";
import Face from "./Face";
import { useI18n } from "./I18n";
import Icon from "./Icon";

type Target = "user" | "memory" | "knowledge";
type Mem = Record<Target, string> & { limits: Record<Target, number>; updated: Record<Target, number | null> };
type LessonView = { id: string; text: string; botId?: string; botName?: string; source: "reflection" | "feedback"; score: number; updatedAt: number };
type Section = "about" | "lessons" | "soul" | "knowledge";
type Msg = { ok: boolean; text: string } | null;

const SECTIONS: Section[] = ["about", "lessons", "soul", "knowledge"];
const SEP = "\n§\n";
const split = (s: string) =>
  s
    .split(/\r?\n§\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
const SECTION_KEY = "oovi.settings.memory";
const SOUL_MAX = 6000;

function Note({ msg }: { msg: Msg }) {
  return msg ? <p className={`mem-msg ${msg.ok ? "msg-ok" : "msg-err"}`} role="status">{msg.text}</p> : null;
}

/** An editable list of short entries (one memory file). */
function FactList({ items, limit, placeholder, empty, onSave }: { items: string[]; limit: number; placeholder: string; empty: string; onSave: (next: string[]) => Promise<boolean> }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const used = items.join(SEP).length;

  async function commit(next: string[]): Promise<boolean> {
    const n = next.join(SEP).length;
    if (n > limit) {
      setErr(t("mem.tooLong", { n, max: limit }));
      return false;
    }
    setErr("");
    setBusy(true);
    try {
      return await onSave(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {items.length ? (
        <ul className="mem-facts">
          {items.map((f, i) => (
            <li key={`${i}-${f.slice(0, 24)}`}>
              {editing === i ? (
                <div className="mem-edit">
                  <textarea rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 70)))} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label={t("common.edit")} />
                  <div className="mem-row">
                    <button
                      className="btn sm primary"
                      disabled={busy || !draft.trim()}
                      onClick={async () => {
                        const next = [...items];
                        next[i] = draft.trim();
                        if (await commit(next)) setEditing(null);
                      }}
                    >
                      {t("common.save")}
                    </button>
                    <button className="btn sm" onClick={() => setEditing(null)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="mem-text">{f}</span>
                  <span className="mem-actions">
                    <button className="icon-btn sm" title={t("common.edit")} aria-label={t("common.edit")} disabled={busy} onClick={() => (setEditing(i), setDraft(f), setErr(""))}>
                      <Icon name="edit" size={15} />
                    </button>
                    <button className="icon-btn sm" title={t("common.delete")} aria-label={t("common.delete")} disabled={busy} onClick={() => void commit(items.filter((_, j) => j !== i))}>
                      <Icon name="trash" size={15} />
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">{empty}</p>
      )}
      <form
        className="mem-add"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = added.trim();
          if (v && (await commit([...items, v]))) setAdded("");
        }}
      >
        <textarea rows={1} value={added} placeholder={placeholder} onChange={(e) => setAdded(e.target.value)} aria-label={placeholder} />
        <button className="btn sm" type="submit" disabled={busy || !added.trim()}>
          <Icon name="plus" size={15} /> {t("common.add")}
        </button>
      </form>
      <span className={`hint${used > limit * 0.9 ? " mem-near" : ""}`}>{t("mem.chars", { n: used, max: limit })}</span>
      {err && <p className="mem-msg msg-err">{err}</p>}
    </>
  );
}

/** One bot's soul: its standing instructions (Bot.instructions). */
function SoulCard({ bot, onSaved }: { bot: Bot; onSaved: (b: Bot) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(bot.instructions ?? "");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"clean" | "saved" | "error">("clean");
  const [err, setErr] = useState("");
  const dirty = text !== (bot.instructions ?? "");

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const next = await api<Bot>(`/api/bots/${encodeURIComponent(bot.id)}`, { method: "PUT", body: JSON.stringify({ ...bot, instructions: text }) });
      onSaved(next);
      setText(next.instructions ?? "");
      setState("saved");
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mem-soul">
      <div className="mem-soul-head">
        <Face face={bot.face} size={44} title={bot.name} />
        <div>
          <b>{bot.name}</b>
          <small>{bot.role || t("mem.soul.noRole")}</small>
        </div>
      </div>
      <label className="field">
        {t("mem.soul.label")}
        <textarea
          rows={5}
          value={text}
          maxLength={SOUL_MAX}
          placeholder={t("mem.soul.ph")}
          onChange={(e) => {
            setText(e.target.value);
            setState("clean");
          }}
        />
      </label>
      <div className="mem-row">
        <button className="btn sm primary" disabled={busy || !dirty} onClick={() => void save()}>
          {t("common.save")}
        </button>
        {dirty ? (
          <span className="mem-state">{t("mem.soul.unsaved")}</span>
        ) : state === "saved" ? (
          <span className="mem-state ok">
            <Icon name="check" size={14} /> {t("mem.soul.saved")}
          </span>
        ) : null}
        <span className="hint mem-push">{t("mem.chars", { n: text.length, max: SOUL_MAX })}</span>
      </div>
      {err && <p className="mem-msg msg-err">{err}</p>}
    </div>
  );
}

export default function MemorySettings() {
  const { t, tag } = useI18n();
  const [section, setSection] = useState<Section>("about");
  const [mem, setMem] = useState<Mem | null>(null);
  const [lessons, setLessons] = useState<LessonView[] | null>(null);
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [learning, setLearning] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const [query, setQuery] = useState("");
  const [botFilter, setBotFilter] = useState("");
  const [editLesson, setEditLesson] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SECTION_KEY) as Section | null;
      if (saved && SECTIONS.includes(saved)) setSection(saved);
    } catch {
      /* storage unavailable */
    }
    api<Mem>("/api/memory").then(setMem).catch((e: Error) => setMsg({ ok: false, text: e.message }));
    api<{ lessons: LessonView[] }>("/api/lessons").then((r) => setLessons(r.lessons)).catch(() => setLessons([]));
    api<Bot[]>("/api/bots").then(setBots).catch(() => setBots([]));
    api<{ learning?: boolean }>("/api/settings").then((s) => setLearning(s.learning !== false)).catch(() => {});
  }, []);

  function pick(s: Section) {
    setSection(s);
    setMsg(null);
    try {
      localStorage.setItem(SECTION_KEY, s);
    } catch {
      /* storage unavailable */
    }
  }

  const saveFile = useCallback(
    async (target: Target, items: string[], done?: string): Promise<boolean> => {
      try {
        setMem(await api<Mem>("/api/memory", { method: "PUT", body: JSON.stringify({ target, text: items.join(SEP) }) }));
        setMsg({ ok: true, text: done ?? t("mem.saved") });
        return true;
      } catch (e) {
        setMsg({ ok: false, text: (e as Error).message });
        return false;
      }
    },
    [t],
  );

  async function lessonCall(init: RequestInit, url = "/api/lessons") {
    setBusy(true);
    try {
      setLessons((await api<{ lessons: LessonView[] }>(url, init)).lessons);
      return true;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const when = (ms: number | null | undefined) => (ms ? t("mem.updated", { when: new Date(ms).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" }) }) : t("mem.never"));

  const lessonBots = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lessons ?? []) if (l.botId && l.botName) m.set(l.botId, l.botName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [lessons]);
  const hasOther = (lessons ?? []).some((l) => !l.botName);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (lessons ?? []).filter((l) => (!q || l.text.toLowerCase().includes(q)) && (!botFilter || (botFilter === "-" ? !l.botName : l.botId === botFilter)));
  }, [lessons, query, botFilter]);

  if (!mem) return msg ? <p className="msg-err">{msg.text}</p> : <p className="note">{t("common.loading")}</p>;
  const userFacts = split(mem.user);

  // ---------- About you ----------
  const about = (
    <div className="card">
      <div className="mem-head">
        <h3 className="card-h">{t("mem.about.title")}</h3>
        <span className="mem-when">{when(mem.updated.user)}</span>
      </div>
      <p className="note mem-intro">{t("mem.about.intro")}</p>
      <FactList items={userFacts} limit={mem.limits.user} placeholder={t("mem.about.ph")} empty={t("mem.about.empty")} onSave={(next) => saveFile("user", next)} />
      {userFacts.length > 0 && (
        <div className="mem-danger">
          {confirmForget ? (
            <>
              <span>{t("mem.forgetConfirm", { n: userFacts.length })}</span>
              <div className="mem-row">
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (await saveFile("user", [], t("mem.forgotten"))) setConfirmForget(false);
                  }}
                >
                  {t("mem.forgetYes")}
                </button>
                <button className="btn sm" onClick={() => setConfirmForget(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </>
          ) : (
            <button className="btn sm danger" onClick={() => (setConfirmForget(true), setMsg(null))}>
              {t("mem.forgetAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ---------- Lessons ----------
  const lessonsView = (
    <>
      <div className="card">
        <h3 className="card-h">{t("mem.lessons.title")}</h3>
        <p className="note mem-intro">{t("mem.lessons.intro")}</p>
        {learning !== null && (
          <label className="check">
            <input
              type="checkbox"
              checked={learning}
              onChange={(e) => {
                const on = e.target.checked;
                setLearning(on);
                api("/api/settings", { method: "POST", body: JSON.stringify({ learning: on }) }).catch((x: Error) => setMsg({ ok: false, text: x.message }));
              }}
            />
            <span>{t("lib.learnToggle")}</span>
          </label>
        )}
        {lessons === null ? (
          <p className="note">{t("common.loading")}</p>
        ) : lessons.length === 0 ? (
          <p className="note">{t("lib.lessonsEmpty")}</p>
        ) : (
          <>
            <div className="mem-bar">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("mem.lessons.search")} aria-label={t("mem.lessons.search")} />
              <select value={botFilter} onChange={(e) => setBotFilter(e.target.value)} aria-label={t("mem.lessons.allBots")}>
                <option value="">{t("mem.lessons.allBots")}</option>
                {lessonBots.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
                {hasOther && <option value="-">{t("mem.lessons.otherBot")}</option>}
              </select>
              <span className="hint">{t("mem.lessons.count", { n: shown.length, total: lessons.length })}</span>
            </div>
            {shown.length === 0 ? (
              <p className="note">{t("mem.lessons.none")}</p>
            ) : (
              <ul className="mem-facts">
                {shown.map((l) => (
                  <li key={l.id} className={l.score <= 0 ? "muted-row" : ""}>
                    {editLesson?.id === l.id ? (
                      <div className="mem-edit">
                        <textarea rows={3} value={editLesson.text} maxLength={300} onChange={(e) => setEditLesson({ id: l.id, text: e.target.value })} autoFocus aria-label={t("common.edit")} />
                        <div className="mem-row">
                          <button
                            className="btn sm primary"
                            disabled={busy || editLesson.text.trim().length < 3}
                            onClick={async () => {
                              if (await lessonCall({ method: "PUT", body: JSON.stringify(editLesson) })) setEditLesson(null);
                            }}
                          >
                            {t("common.save")}
                          </button>
                          <button className="btn sm" onClick={() => setEditLesson(null)}>
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mem-text">
                          <span>{l.text}</span>
                          <small>
                            {[l.botName ? t("lib.byBot", { name: l.botName }) : "", l.source === "feedback" ? t("lib.fromFeedback") : "", new Date(l.updatedAt).toLocaleDateString(tag), t("mem.lessons.score", { n: l.score })].filter(Boolean).join(" · ")}
                            {l.score <= 0 && (
                              <span className="tag mem-tag" title={t("mem.lessons.mutedHint")}>
                                {t("mem.lessons.muted")}
                              </span>
                            )}
                          </small>
                        </div>
                        <span className="mem-actions">
                          <button className="icon-btn sm" title={t("mem.lessons.up")} aria-label={t("mem.lessons.up")} disabled={busy} onClick={() => void lessonCall({ method: "PATCH", body: JSON.stringify({ id: l.id, delta: 1 }) })}>
                            <Icon name="thumbUp" size={15} />
                          </button>
                          <button className="icon-btn sm" title={t("mem.lessons.down")} aria-label={t("mem.lessons.down")} disabled={busy || l.score <= 0} onClick={() => void lessonCall({ method: "PATCH", body: JSON.stringify({ id: l.id, delta: -1 }) })}>
                            <Icon name="thumbDown" size={15} />
                          </button>
                          <button className="icon-btn sm" title={t("common.edit")} aria-label={t("common.edit")} disabled={busy} onClick={() => setEditLesson({ id: l.id, text: l.text })}>
                            <Icon name="edit" size={15} />
                          </button>
                          <button className="icon-btn sm" title={t("lib.forget")} aria-label={t("lib.forget")} disabled={busy} onClick={() => void lessonCall({ method: "DELETE" }, `/api/lessons?id=${encodeURIComponent(l.id)}`)}>
                            <Icon name="trash" size={15} />
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="card">
        <div className="mem-head">
          <h3 className="card-h">{t("mem.notes.title")}</h3>
          <span className="mem-when">{when(mem.updated.memory)}</span>
        </div>
        <p className="note mem-intro">{t("mem.notes.intro")}</p>
        <FactList items={split(mem.memory)} limit={mem.limits.memory} placeholder={t("mem.notes.ph")} empty={t("mem.notes.empty")} onSave={(next) => saveFile("memory", next)} />
      </div>
    </>
  );

  // ---------- Soul ----------
  const soul = (
    <>
      <p className="note mem-sub">{t("mem.soul.intro")}</p>
      <div className="card mem-tip">
        <Icon name="bulb" size={18} />
        <div>
          <b>{t("mem.soul.tipTitle")}</b>
          <p className="note">{t("mem.soul.tip")}</p>
        </div>
      </div>
      {bots === null ? (
        <p className="note">{t("common.loading")}</p>
      ) : bots.length === 0 ? (
        <p className="note">{t("mem.soul.noBots")}</p>
      ) : (
        <div className="mem-souls">
          {bots.map((b) => (
            <SoulCard key={b.id} bot={b} onSaved={(nb) => setBots((cur) => (cur ?? []).map((x) => (x.id === nb.id ? nb : x)))} />
          ))}
        </div>
      )}
    </>
  );

  // ---------- Knowledge ----------
  const knowledge = (
    <div className="card">
      <div className="mem-head">
        <h3 className="card-h">{t("mem.knowledge.title")}</h3>
        <span className="mem-when">{when(mem.updated.knowledge)}</span>
      </div>
      <p className="note mem-intro">{t("mem.knowledge.intro")}</p>
      <FactList items={split(mem.knowledge)} limit={mem.limits.knowledge} placeholder={t("mem.knowledge.ph")} empty={t("mem.knowledge.empty")} onSave={(next) => saveFile("knowledge", next)} />
      <p className="note mem-cap">{t("mem.knowledge.cap", { max: mem.limits.knowledge })}</p>
    </div>
  );

  const views: Record<Section, React.ReactNode> = { about, lessons: lessonsView, soul, knowledge };

  return (
    <div className="mem-settings">
      <p className="lead">{t("mem.lead")}</p>
      <div className="seg-tabs mem-tabs" role="tablist">
        {SECTIONS.map((x) => (
          <button key={x} role="tab" aria-selected={section === x} className={section === x ? "on" : ""} onClick={() => pick(x)}>
            {t(`mem.sec.${x}`)}
          </button>
        ))}
      </div>
      {views[section]}
      <Note msg={msg} />
    </div>
  );
}
