"use client";

// Settings > Saved logins: sites where bots may sign in for the user with fill_login. The password and the
// two-step key are typed here once, stored encrypted on this computer, and never shown to a bot or again here.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useI18n } from "./I18n";

type Login = { id: string; site: string; username: string; hasCode: boolean };

export default function SavedLogins() {
  const { t } = useI18n();
  const [list, setList] = useState<Login[] | null>(null);
  const [form, setForm] = useState({ site: "", username: "", password: "", code: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<{ logins: Login[] }>("/api/logins")
      .then((r) => setList(r.logins))
      .catch(() => setList([]));
  }, []);
  useEffect(load, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/logins", { method: "POST", body: JSON.stringify(form) });
      setForm({ site: "", username: "", password: "", code: "" });
      setMsg({ ok: true, text: t("logins.saved") });
      load();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function remove(l: Login) {
    if (!window.confirm(t("logins.confirmRemove", { site: l.site, username: l.username }))) return;
    await api(`/api/logins?id=${encodeURIComponent(l.id)}`, { method: "DELETE" }).catch(() => {});
    load();
  }

  return (
    <div className="card saved-logins">
      <h3>{t("logins.title")}</h3>
      <p className="hint">{t("logins.intro")}</p>
      {list && list.length > 0 && (
        <ul className="logins-list">
          {list.map((l) => (
            <li key={l.id}>
              <b>{l.site}</b>
              <span className="muted">{l.username}</span>
              {l.hasCode && <span className="pill">{t("logins.withCode")}</span>}
              <button type="button" className="btn sm ghost" onClick={() => void remove(l)}>
                {t("common.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="logins-form" onSubmit={(e) => void add(e)} autoComplete="off">
        <div className="grid">
          <label className="field">
            {t("logins.site")}
            <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="facebook.com" required inputMode="url" />
          </label>
          <label className="field">
            {t("logins.username")}
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" />
          </label>
          <label className="field">
            {t("logins.password")}
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" />
          </label>
          <label className="field">
            {t("logins.code")}
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t("logins.codePh")} autoComplete="off" spellCheck={false} />
          </label>
        </div>
        <p className="hint">{t("logins.codeHint")}</p>
        <button className="btn primary" disabled={busy}>
          {t("logins.add")}
        </button>
        {msg && (
          <p className={msg.ok ? "ok-text" : "err-text"} role="status">
            {msg.text}
          </p>
        )}
      </form>
    </div>
  );
}
