"use client";

// Settings > Telegram > Advanced (collapsed by default): link other Telegram chats, usually
// Telegram groups, to an oovi group. Hidden from the simple setup on purpose.
import { useCallback, useEffect, useState } from "react";
import type { TelegramStatus } from "@/lib/telegram";
import { useI18n } from "./I18n";
import Icon from "./Icon";

const OPEN_KEY = "oovi.telegram.advanced";
/** Same rule as the server (lib/telegram-links.ts parseChatId): a whole number, negative for groups. */
const CHAT_ID_RE = /^-?[1-9]\d{0,15}$/;
const normalizeId = (s: string) => s.trim().replace(/−/g, "-").replace(/\s+/g, "");

type Form = { chatId: string; label: string; groupId: string; previousChatId?: string };

export default function TelegramAdvanced({ st, onStatus }: { st: TelegramStatus; onStatus: (s: TelegramStatus) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<{ id: string; name: string }[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      /* storage blocked: stay closed */
    }
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* not remembered, that's fine */
    }
  }

  const refresh = useCallback(async () => {
    const r = await fetch("/api/telegram?advanced=1");
    if (!r.ok) return;
    const s = (await r.json()) as TelegramStatus;
    setGroups(s.groups ?? []);
    onStatus(s);
  }, [onStatus]);

  // While open, check every few seconds so chats that just wrote to the bot show up.
  useEffect(() => {
    if (!open) return;
    void refresh().catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [open, refresh]);

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as TelegramStatus & { error?: string };
      if (!r.ok) throw new Error(j.error ?? t("tg.failed"));
      if (j.groups) setGroups(j.groups);
      onStatus(j);
      setMsg({ ok: true, text: done });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form) return;
    const chatId = normalizeId(form.chatId);
    if (!CHAT_ID_RE.test(chatId)) return setMsg({ ok: false, text: t("tg.adv.badId") });
    if (!form.groupId) return setMsg({ ok: false, text: t("tg.adv.needGroup") });
    if (await post({ action: "link", chatId, groupId: form.groupId, label: form.label, previousChatId: form.previousChatId }, t("tg.adv.linked"))) setForm(null);
  }

  const bot = st.botUsername ? `@${st.botUsername}` : t("tg.yourMainBot");
  const username = st.botUsername ?? "your_bot";

  return (
    <section className={`tg-adv${open ? " open" : ""}`}>
      <button type="button" className="tg-adv-toggle" aria-expanded={open} onClick={toggle}>
        <Icon name="chevron" size={14} />
        <span>{t("tg.adv.title")}</span>
        <small>{t("tg.adv.sub")}</small>
      </button>

      {open && (
        <div className="tg-adv-body">
          <h4>{t("tg.adv.linkTitle")}</h4>
          <p className="note">{t("tg.adv.linkText", { name: st.mainName || t("tg.yourMainBot") })}</p>

          {st.detected.length > 0 && (
            <ul className="tg-waiting">
              {st.detected.map((d) => (
                <li key={d.chatId}>
                  <span className="tg-waiting-text">
                    {t("tg.adv.waiting")} <b>{d.title}</b> <code>({d.chatId})</code>
                  </span>
                  <span className="tg-row-act">
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => {
                        setMsg(null);
                        setForm({ chatId: d.chatId, label: d.title, groupId: groups?.[0]?.id ?? "" });
                      }}
                    >
                      {t("tg.adv.linkTo")}
                    </button>
                    <button type="button" className="icon-btn" disabled={busy} title={t("tg.adv.dismiss")} aria-label={t("tg.adv.dismiss")} onClick={() => void post({ action: "dismiss", chatId: d.chatId }, t("tg.adv.dismissed"))}>
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {st.links.length ? (
            <ul className="tg-links">
              {st.links.map((l) => (
                <li key={l.chatId}>
                  <span className="tg-link-main">
                    <b>{l.label}</b>
                    <small>
                      <code>{l.chatId}</code> → {l.groupName ?? <span className="tg-gone">{t("tg.adv.goneGroup")}</span>}
                    </small>
                  </span>
                  <span className="tg-row-act">
                    <button type="button" className="icon-btn" disabled={busy} title={t("common.edit")} aria-label={t("common.edit")} onClick={() => setForm({ chatId: l.chatId, label: l.label, groupId: l.groupId, previousChatId: l.chatId })}>
                      <Icon name="edit" size={15} />
                    </button>
                    <button type="button" className="icon-btn" disabled={busy} title={t("common.remove")} aria-label={t("common.remove")} onClick={() => void post({ action: "unlink", chatId: l.chatId }, t("tg.adv.unlinked"))}>
                      <Icon name="trash" size={15} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            !form && <p className="note">{t("tg.adv.none")}</p>
          )}

          {form ? (
            <div className="tg-link-form">
              {groups && !groups.length ? (
                <p className="note">{t("tg.adv.noGroups")}</p>
              ) : (
                <>
                  <label className="field">
                    {t("tg.adv.chatId")}
                    <input type="text" inputMode="numeric" autoComplete="off" spellCheck={false} value={form.chatId} placeholder="-1001234567890" onChange={(e) => setForm({ ...form, chatId: e.target.value })} />
                    <small className="note">{t("tg.adv.chatIdHint")}</small>
                  </label>
                  <label className="field">
                    {t("tg.adv.group")}
                    <select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                      <option value="">{t("tg.adv.pickGroup")}</option>
                      {(groups ?? []).map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    {t("tg.adv.label")}
                    <input type="text" maxLength={48} value={form.label} placeholder={t("tg.adv.labelPh")} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                  </label>
                </>
              )}
              <div className="row-btns">
                {!(groups && !groups.length) && (
                  <button type="button" className="btn primary sm" disabled={busy || !form.chatId.trim()} onClick={() => void save()}>
                    {t("common.save")}
                  </button>
                )}
                <button type="button" className="btn sm" disabled={busy} onClick={() => setForm(null)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => {
                setMsg(null);
                setForm({ chatId: "", label: "", groupId: groups?.[0]?.id ?? "" });
              }}
            >
              <Icon name="plus" size={14} /> {t("tg.adv.add")}
            </button>
          )}

          {msg && <p className={msg.ok ? "msg-ok" : "msg-err"}>{msg.text}</p>}

          <details className="tg-help">
            <summary>{t("tg.adv.howTitle")}</summary>
            <ol>
              <li>{t("tg.adv.how1", { bot })}</li>
              <li>{t("tg.adv.how2", { username })}</li>
              <li>{t("tg.adv.how3")}</li>
            </ol>
            <p className="note">{t("tg.adv.how4")}</p>
          </details>
          <details className="tg-help">
            <summary>{t("tg.adv.groupsTitle")}</summary>
            <ul>
              <li>{t("tg.adv.privacy1", { username })}</li>
              <li>{t("tg.adv.privacy2", { username })}</li>
              <li>{t("tg.adv.privacy3")}</li>
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
