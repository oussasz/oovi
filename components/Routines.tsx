"use client";

// Routines: tasks a bot does on its own on a schedule ("every morning, summarize my email").
// Each one runs in its own chat; results arrive as a notification (and on Telegram if asked).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { desktop, type BackgroundState } from "@/lib/desktop";
import type { TKey } from "@/lib/i18n";
import type { Bot, RoutineSchedule, RoutineView } from "@/lib/types";
import Face from "./Face";
import { useI18n } from "./I18n";
import Icon from "./Icon";
import { openSettings } from "./SettingsModal";

type Kind = RoutineSchedule["kind"];
type Draft = { name: string; botId: string; prompt: string; kind: Kind; time: string; days: number[]; every: number; notifyTelegram: boolean };
type Data = { routines: RoutineView[]; telegram: boolean; max: number };
type Editing = { id?: string; draft: Draft };

const NAME_MAX = 60;
const PROMPT_MAX = 4000;
const POLL_MS = 10_000;
/** Mon … Sun (0 = Sunday). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
/** The instruction talks about email or a calendar (most languages oovi speaks): say where those come from. */
const NEEDS_CONNECTOR = /e-?mail|gmail|outlook|inbox|courriel|correo|posta|calendar|calendrier|agenda|kalender|takvim|termin|réunion|meeting|bandeja|البريد|إيميل|تقويم|اجتماع/i;

const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const scheduleOf = (d: Draft): RoutineSchedule => (d.kind === "weekly" ? { kind: "weekly", time: d.time, days: d.days } : d.kind === "hourly" ? { kind: "hourly", every: d.every, from: d.time } : { kind: "daily", time: d.time });

function draftOf(r: RoutineView): Draft {
  const s = r.schedule;
  return {
    name: r.name,
    botId: r.botId,
    prompt: r.prompt,
    kind: s.kind,
    time: s.kind === "hourly" ? s.from : s.time,
    days: s.kind === "weekly" ? s.days : [1, 2, 3, 4, 5],
    every: s.kind === "hourly" ? s.every : 3,
    notifyTelegram: r.notifyTelegram,
  };
}

export default function Routines() {
  const { t, tag } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [mainId, setMainId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<RoutineView | null>(null);
  const [bg, setBg] = useState<BackgroundState | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api<Data>("/api/routines"));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    api<Bot[]>("/api/bots")
      .then(setBots)
      .catch(() => {});
    api<{ botId: string | null }>("/api/main")
      .then((m) => setMainId(m.botId))
      .catch(() => {});
    desktop()
      ?.background?.get()
      .then(setBg)
      .catch(() => {});
  }, [refresh]);

  // Keep next / last run fresh while the page is visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // The delete dialog is a native modal: focus is trapped and Esc closes it.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (confirmDel && !d.open) d.showModal();
    if (!confirmDel && d.open) d.close();
  }, [confirmDel]);

  // Open the form with its first field focused.
  useEffect(() => {
    if (editing) formRef.current?.querySelector<HTMLInputElement>("input[name=name]")?.focus();
  }, [editing?.id, !!editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const botList = useMemo(() => {
    const main = bots.find((b) => b.id === mainId);
    return main ? [main, ...bots.filter((b) => b !== main)] : bots;
  }, [bots, mainId]);

  // ---------- formatting ----------

  const fmtTime = useCallback(
    (hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      try {
        return new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, h ?? 0, m ?? 0)));
      } catch {
        return hhmm;
      }
    },
    [tag],
  );
  const dayName = useCallback(
    (d: number, style: "short" | "long") => {
      try {
        return new Intl.DateTimeFormat(tag, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + d))); // 1 Jan 2023 was a Sunday
      } catch {
        return String(d);
      }
    },
    [tag],
  );
  const fmtWhen = useCallback(
    (ms: number) => {
      try {
        return new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
      } catch {
        return new Date(ms).toLocaleString();
      }
    },
    [tag],
  );
  const describe = useCallback(
    (s: RoutineSchedule) => {
      if (s.kind === "daily") return t("routines.sched.daily", { time: fmtTime(s.time) });
      if (s.kind === "weekly") {
        const key = s.days.join(",");
        if (s.days.length === 7) return t("routines.sched.daily", { time: fmtTime(s.time) });
        if (key === "1,2,3,4,5") return t("routines.sched.weekdays", { time: fmtTime(s.time) });
        if (key === "0,6") return t("routines.sched.weekends", { time: fmtTime(s.time) });
        const ordered = WEEK.filter((d) => s.days.includes(d));
        return t("routines.sched.weekly", { days: ordered.map((d) => dayName(d, "short")).join(", "), time: fmtTime(s.time) });
      }
      return t("routines.sched.hourly", { count: s.every, time: fmtTime(s.from) });
    },
    [t, fmtTime, dayName],
  );

  // ---------- actions ----------

  const announce = (text: string) => {
    setStatus("");
    // A fresh text node each time so screen readers read it even when it repeats.
    requestAnimationFrame(() => setStatus(text));
  };

  function openNew(e: React.MouseEvent<HTMLElement>, preset?: Partial<Draft>) {
    opener.current = e.currentTarget;
    setFormError(null);
    setEditing({
      draft: { name: "", botId: botList[0]?.id ?? "", prompt: "", kind: "daily", time: "08:00", days: [1, 2, 3, 4, 5], every: 3, notifyTelegram: false, ...preset },
    });
  }

  function openEdit(e: React.MouseEvent<HTMLElement>, r: RoutineView) {
    opener.current = e.currentTarget;
    setFormError(null);
    setEditing({ id: r.id, draft: draftOf(r) });
  }

  function closeForm() {
    setEditing(null);
    setFormError(null);
    requestAnimationFrame(() => opener.current?.focus());
  }

  const setDraft = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editing || saving) return;
    const d = editing.draft;
    if (!d.name.trim()) return setFormError(t("routines.err.name"));
    if (!d.prompt.trim()) return setFormError(t("routines.err.prompt"));
    if (!d.botId) return setFormError(t("routines.err.bot"));
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) return setFormError(t("routines.err.time"));
    if (d.kind === "weekly" && !d.days.length) return setFormError(t("routines.err.days"));
    if (d.kind === "hourly" && !(Number.isInteger(d.every) && d.every >= 1 && d.every <= 24)) return setFormError(t("routines.err.every"));
    setSaving(true);
    setFormError(null);
    // Times mean the user's own clock: the routine follows this computer's time zone.
    const body = JSON.stringify({ name: d.name.trim(), botId: d.botId, prompt: d.prompt.trim(), schedule: scheduleOf(d), timezone: localZone(), notifyTelegram: d.notifyTelegram, ...(editing.id ? {} : { enabled: true }) });
    try {
      if (editing.id) await api(`/api/routines/${encodeURIComponent(editing.id)}`, { method: "PATCH", body });
      else await api("/api/routines", { method: "POST", body });
      announce(editing.id ? t("routines.saved", { name: d.name.trim() }) : t("routines.created", { name: d.name.trim() }));
      setEditing(null);
      await refresh();
      requestAnimationFrame(() => opener.current?.focus());
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(r: RoutineView, on: boolean) {
    setBusy(r.id);
    setRowError(null);
    try {
      await api(`/api/routines/${encodeURIComponent(r.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: on }) });
      announce(on ? t("routines.turnedOn", { name: r.name }) : t("routines.turnedOff", { name: r.name }));
      await refresh();
    } catch (e) {
      setRowError({ id: r.id, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function runNow(r: RoutineView) {
    setBusy(r.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/routines/${encodeURIComponent(r.id)}/run`, { method: "POST" });
      if (res.ok) announce(t("routines.started", { name: r.name }));
      else {
        const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        const key: TKey = code === "busy" ? "routines.run.busy" : code === "waiting" ? "routines.run.waiting" : code === "bot" ? "routines.run.bot" : "routines.run.failed";
        setRowError({ id: r.id, text: t(key) });
      }
      await refresh();
    } catch (e) {
      setRowError({ id: r.id, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: RoutineView) {
    setConfirmDel(null);
    setBusy(r.id);
    try {
      await api(`/api/routines/${encodeURIComponent(r.id)}`, { method: "DELETE" });
      announce(t("routines.deleted", { name: r.name }));
      if (editing?.id === r.id) setEditing(null);
      await refresh();
      requestAnimationFrame(() => document.getElementById("routines-new")?.focus());
    } catch (e) {
      setRowError({ id: r.id, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function setBackground(on: boolean) {
    const next = await desktop()
      ?.background?.set(on)
      .catch(() => null);
    if (next) {
      setBg(next);
      announce(next.on ? t("routines.bg.turnedOn") : t("routines.bg.turnedOff"));
    }
  }

  // ---------- render ----------

  if (!data) {
    return (
      <div className="page center muted" role="status">
        {loadError ?? t("common.loading")}
      </div>
    );
  }

  const routines = data.routines;
  const anyOn = routines.some((r) => r.enabled);
  const full = routines.length >= data.max;
  const zone = localZone();
  const botOf = (id: string) => bots.find((b) => b.id === id);

  const lastRunText = (r: RoutineView): string => {
    const l = r.lastRun;
    if (!l) return t("routines.last.never");
    const note = l.status === "skipped" ? (l.note === "busy" ? t("routines.note.busy") : l.note === "waiting" ? t("routines.note.waiting") : l.note === "stopped" ? t("routines.note.stopped") : "") : l.status === "missed" ? t("routines.note.missed") : l.status === "error" ? (l.note ?? "") : "";
    const head = t(`routines.last.${l.status}`, { when: fmtWhen(l.at) });
    return note ? `${head} · ${note}` : head;
  };

  return (
    <div className="page narrow routines-page">
      <header className="routines-head">
        <div>
          <h1>
            <Icon name="clock" size={26} /> {t("routines.title")}
          </h1>
          <p className="muted">{t("routines.sub")}</p>
        </div>
        <button id="routines-new" type="button" className="btn primary" onClick={(e) => openNew(e)} disabled={full || !!editing} aria-describedby={full ? "routines-full" : undefined}>
          <Icon name="plus" size={16} /> {t("routines.new")}
        </button>
      </header>
      {full && (
        <p id="routines-full" className="hint">
          {t("routines.full", { count: data.max })}
        </p>
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {status}
      </div>

      {bg?.supported && anyOn && !bg.on && (
        <div className="notice routines-bg-notice">
          <p>{t("routines.bg.suggest")}</p>
          <button type="button" className="btn sm" onClick={() => void setBackground(true)}>
            {t("routines.bg.enable")}
          </button>
        </div>
      )}
      {!bg && anyOn && <p className="hint routines-open-hint">{t("routines.openHint")}</p>}

      {editing && (
        <form ref={formRef} className="card routine-form" onSubmit={submit} aria-labelledby="routine-form-title" noValidate>
          <h2 id="routine-form-title">{editing.id ? t("routines.form.editTitle") : t("routines.form.newTitle")}</h2>

          <label className="field" htmlFor="routine-name">
            {t("routines.form.name")}
            <input id="routine-name" name="name" value={editing.draft.name} maxLength={NAME_MAX} required placeholder={t("routines.form.namePh")} onChange={(e) => setDraft({ name: e.target.value })} />
          </label>

          <label className="field" htmlFor="routine-bot">
            {t("routines.form.bot")}
            <select id="routine-bot" value={editing.draft.botId} onChange={(e) => setDraft({ botId: e.target.value })} required>
              {!botOf(editing.draft.botId) && <option value="">{t("routines.form.pickBot")}</option>}
              {botList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.role ? ` — ${b.role}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="field" htmlFor="routine-prompt">
            {t("routines.form.prompt")}
            <textarea id="routine-prompt" rows={4} value={editing.draft.prompt} maxLength={PROMPT_MAX} required placeholder={t("routines.form.promptPh")} aria-describedby="routine-prompt-hint" onChange={(e) => setDraft({ prompt: e.target.value })} />
          </label>
          <p id="routine-prompt-hint" className="hint">
            {t("routines.form.promptHint")}
            {NEEDS_CONNECTOR.test(editing.draft.prompt) && (
              <>
                {" "}
                {t("routines.form.connectorHint")} <Link href="/library?tab=connectors">{t("routines.form.connectorLink")}</Link>
              </>
            )}
          </p>

          <fieldset className="routine-when">
            <legend>{t("routines.form.when")}</legend>
            <div className="chip-row">
              {(["daily", "weekly", "hourly"] as const).map((k) => (
                <label key={k} className={`chip big routine-kind${editing.draft.kind === k ? " on" : ""}`}>
                  <input type="radio" name="routine-kind" value={k} checked={editing.draft.kind === k} onChange={() => setDraft({ kind: k })} />
                  {t(`routines.kind.${k}`)}
                </label>
              ))}
            </div>

            {editing.draft.kind === "weekly" && (
              <fieldset className="routine-days">
                <legend>{t("routines.form.days")}</legend>
                {WEEK.map((d) => {
                  const on = editing.draft.days.includes(d);
                  return (
                    <label key={d} className={`chip routine-day${on ? " on" : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => setDraft({ days: on ? editing.draft.days.filter((x) => x !== d) : [...editing.draft.days, d].sort((a, b) => a - b) })} />
                      <span aria-hidden="true">{dayName(d, "short")}</span>
                      <span className="sr-only">{dayName(d, "long")}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}

            <div className="routine-time-row">
              {editing.draft.kind === "hourly" && (
                <label className="field" htmlFor="routine-every">
                  {t("routines.form.every")}
                  <span className="routine-every">
                    <input id="routine-every" type="number" inputMode="numeric" min={1} max={24} step={1} value={Number.isFinite(editing.draft.every) ? editing.draft.every : ""} onChange={(e) => setDraft({ every: Math.round(Number(e.target.value)) })} />
                    <span>{t("routines.form.hours", { count: editing.draft.every || 0 })}</span>
                  </span>
                </label>
              )}
              <label className="field" htmlFor="routine-time">
                {editing.draft.kind === "hourly" ? t("routines.form.from") : t("routines.form.time")}
                <input id="routine-time" type="time" step={60} value={editing.draft.time} required onChange={(e) => setDraft({ time: e.target.value.slice(0, 5) })} />
              </label>
            </div>
            <p className="hint">
              {t("routines.form.preview", { schedule: describe(scheduleOf(editing.draft)) })} {t("routines.form.zone", { zone })}
            </p>
          </fieldset>

          <label className={`toggle${!data.telegram && !editing.draft.notifyTelegram ? " disabled" : ""}`}>
            <input type="checkbox" checked={editing.draft.notifyTelegram} disabled={!data.telegram && !editing.draft.notifyTelegram} onChange={(e) => setDraft({ notifyTelegram: e.target.checked })} aria-describedby="routine-tg-hint" />
            <span className="toggle-ui" />
            <span>
              <b>{t("routines.form.telegram")}</b>
              <span id="routine-tg-hint" className="hint">
                {data.telegram ? t("routines.form.telegramHint") : t("routines.form.telegramOff")}
              </span>
            </span>
          </label>
          {!data.telegram && (
            <button type="button" className="btn sm" onClick={() => openSettings("telegram")}>
              {t("routines.form.connectTelegram")}
            </button>
          )}

          <p className="hint">{t("routines.form.safety")}</p>

          <div className="row wrap routine-form-actions">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? t("routines.form.saving") : editing.id ? t("common.save") : t("routines.form.create")}
            </button>
            <button type="button" className="btn" onClick={closeForm} disabled={saving}>
              {t("common.cancel")}
            </button>
            {formError && (
              <span className="msg-err" role="alert">
                {formError}
              </span>
            )}
          </div>
        </form>
      )}

      {routines.length === 0 && !editing && (
        <section className="card routines-empty">
          <h2>{t("routines.empty.title")}</h2>
          <p className="muted">{t("routines.empty.sub")}</p>
          <div className="routines-examples">
            {(
              [
                { key: "email", preset: { kind: "daily", time: "08:00" } },
                { key: "week", preset: { kind: "weekly", time: "09:00", days: [1] } },
                { key: "news", preset: { kind: "hourly", time: "08:00", every: 4 } },
              ] as const
            ).map((ex) => (
              <button key={ex.key} type="button" className="idea" onClick={(e) => openNew(e, { ...ex.preset, days: "days" in ex.preset ? [...ex.preset.days] : [1, 2, 3, 4, 5], name: t(`routines.ex.${ex.key}.name`), prompt: t(`routines.ex.${ex.key}.prompt`) })}>
                <b>{t(`routines.ex.${ex.key}.name`)}</b>
                <span>{t(`routines.ex.${ex.key}.prompt`)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {routines.length > 0 && (
        <ul className="routine-list" aria-label={t("routines.title")}>
          {routines.map((r) => {
            const bot = botOf(r.botId);
            const rowBusy = busy === r.id;
            return (
              <li key={r.id} className={`card routine-card${r.enabled ? "" : " off"}`} aria-busy={rowBusy || undefined}>
                <div className="routine-top">
                  {bot && <Face face={bot.face} size={40} mood={r.running ? "working" : r.lastRun?.status === "waiting" ? "asking" : "idle"} />}
                  <div className="routine-title">
                    <h2>{r.name}</h2>
                    <p className="muted">
                      {describe(r.schedule)}
                      {r.timezone !== zone && <span className="routine-zone"> ({r.timezone})</span>}
                      {" · "}
                      {bot ? bot.name : t("routines.botGone")}
                    </p>
                  </div>
                  <label className="toggle routine-switch">
                    <input type="checkbox" checked={r.enabled} disabled={rowBusy} onChange={(e) => void toggle(r, e.target.checked)} aria-label={t("routines.switchAria", { name: r.name })} />
                    <span className="toggle-ui" />
                    <span aria-hidden="true">{r.enabled ? t("routines.on") : t("routines.off")}</span>
                  </label>
                </div>

                <dl className="routine-meta">
                  <div>
                    <dt>{t("routines.next")}</dt>
                    <dd>{r.enabled && r.nextRunAt ? fmtWhen(r.nextRunAt) : r.pausedReason === "failures" ? t("routines.pausedFailures") : r.pausedReason === "bot" ? t("routines.pausedBot") : t("routines.paused")}</dd>
                  </div>
                  <div>
                    <dt>{t("routines.lastRun")}</dt>
                    <dd>
                      {r.running ? (
                        <span className="pill run">
                          <span className="live-dot" aria-hidden="true" /> {t("routines.running")}
                        </span>
                      ) : (
                        <span className={`pill ${r.lastRun?.status ?? "none"}`}>{lastRunText(r)}</span>
                      )}
                    </dd>
                  </div>
                </dl>
                {r.prompt && <p className="routine-prompt">{r.prompt}</p>}

                <div className="row wrap routine-actions">
                  <Link className="btn sm" href={`/c/${encodeURIComponent(r.chatId)}`}>
                    {r.lastRun?.status === "waiting" ? t("routines.openWaiting") : t("routines.openChat")}
                  </Link>
                  <button type="button" className="btn sm" onClick={() => void runNow(r)} disabled={rowBusy || r.running} aria-label={t("routines.runNowAria", { name: r.name })}>
                    <Icon name="send" size={14} /> {t("routines.runNow")}
                  </button>
                  <button type="button" className="btn sm" onClick={(e) => openEdit(e, r)} disabled={!!editing} aria-label={t("routines.editAria", { name: r.name })}>
                    <Icon name="edit" size={14} /> {t("common.edit")}
                  </button>
                  <button type="button" className="btn sm danger" onClick={() => setConfirmDel(r)} disabled={rowBusy} aria-label={t("routines.deleteAria", { name: r.name })}>
                    <Icon name="trash" size={14} /> {t("common.delete")}
                  </button>
                </div>
                {rowError?.id === r.id && (
                  <p className="msg-err" role="alert">
                    {rowError.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {bg?.supported && (
        <section className="card routines-bg">
          <label className="toggle">
            <input type="checkbox" checked={bg.on} onChange={(e) => void setBackground(e.target.checked)} />
            <span className="toggle-ui" />
            <span>
              <b>{t("routines.bg.label")}</b>
              <span className="hint">{t("routines.bg.hint")}</span>
            </span>
          </label>
        </section>
      )}

      <dialog ref={dialogRef} className="routine-dialog" aria-labelledby="routine-del-title" aria-describedby="routine-del-text" onClose={() => setConfirmDel(null)} onCancel={() => setConfirmDel(null)}>
        {confirmDel && (
          <form method="dialog" onSubmit={(e) => e.preventDefault()}>
            <h2 id="routine-del-title">{t("routines.del.title", { name: confirmDel.name })}</h2>
            <p id="routine-del-text" className="muted">
              {t("routines.del.text")}
            </p>
            <div className="row wrap">
              <button type="button" className="btn" autoFocus onClick={() => setConfirmDel(null)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn danger" onClick={() => void remove(confirmDel)}>
                <Icon name="trash" size={16} /> {t("common.delete")}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
