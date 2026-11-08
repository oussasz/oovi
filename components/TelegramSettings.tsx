"use client";

// Settings > Telegram: talk to your main bot from your phone, in three steps.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Bot, ChatSummary } from "@/lib/types";
import { useI18n } from "./I18n";
import Icon from "./Icon";

type Status = { hasToken: boolean; botUsername?: string; botName?: string; connected: boolean; userName?: string; pairLink?: string; error?: string };

export default function TelegramSettings() {
  const { t } = useI18n();
  const [st, setSt] = useState<Status | null>(null);
  const [tokenIn, setTokenIn] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mainName, setMainName] = useState<string>("");

  const load = useCallback(async () => {
    try {
      setSt(await api<Status>("/api/telegram"));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
    // Name of the main bot (the one that leads the most groups).
    Promise.all([api<Bot[]>("/api/bots"), api<ChatSummary[]>("/api/chats")])
      .then(([bots, chats]) => {
        const leads = new Map<string, number>();
        for (const c of chats) if (c.kind === "group" && c.leadId) leads.set(c.leadId, (leads.get(c.leadId) ?? 0) + 1);
        const main = [...bots].sort((a, b) => (leads.get(b.id) ?? 0) - (leads.get(a.id) ?? 0) || a.createdAt - b.createdAt)[0];
        setMainName(main?.name ?? "");
      })
      .catch(() => {});
  }, [load]);

  // While waiting for the user to press Start in Telegram, check every few seconds.
  useEffect(() => {
    if (!st?.hasToken || st.connected) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [st?.hasToken, st?.connected, load]);

  async function run(fn: () => Promise<Status | void>, done?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const next = await fn();
      if (next) setSt(next);
      if (done) setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const call = async (method: string, body?: unknown) => {
    const r = await fetch("/api/telegram", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = (await r.json()) as Status & { error?: string };
    if (!r.ok) throw new Error(j.error ?? t("tg.failed"));
    return j;
  };

  if (!st) return <p className="note">{t("common.loading")}</p>;
  const name = mainName || t("tg.yourMainBot");

  return (
    <>
      <p className="lead">{t("tg.lead", { name })}</p>

      {st.connected ? (
        <div className="card">
          <h3 className="card-h">
            <span className="dot-ok" /> {t("tg.connectedTitle")}
          </h3>
          <p>{t("tg.connectedText", { user: st.userName ?? "", bot: `@${st.botUsername ?? ""}`, name })}</p>
          <ul className="plain-list">
            <li>{t("tg.how1")}</li>
            <li>{t("tg.how2")}</li>
            <li>{t("tg.how3")}</li>
          </ul>
          <div className="row-btns">
            {st.botUsername && (
              <a className="btn" href={`https://t.me/${st.botUsername}`} target="_blank" rel="noreferrer noopener">
                <Icon name="send" size={16} /> {t("tg.open", { bot: `@${st.botUsername}` })}
              </a>
            )}
            <button className="btn" disabled={busy} onClick={() => void run(() => call("POST", { action: "test" }), t("tg.testSent"))}>
              {t("tg.test")}
            </button>
            <button className="btn" disabled={busy} onClick={() => void run(() => call("DELETE"), t("tg.disconnected"))}>
              {t("tg.disconnect")}
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <ol className="tg-steps">
            <li className={st.hasToken ? "done" : "now"}>
              <b>{t("tg.step1")}</b>
              <p className="note">{t("tg.step1Text")}</p>
              {!st.hasToken && (
                <a className="btn sm" href="https://t.me/BotFather" target="_blank" rel="noreferrer noopener">
                  {t("tg.openBotFather")}
                </a>
              )}
            </li>
            <li className={st.hasToken ? "done" : "now"}>
              <b>{t("tg.step2")}</b>
              {st.hasToken ? (
                <p className="note">{t("tg.tokenSaved", { bot: `@${st.botUsername ?? ""}` })}</p>
              ) : (
                <div className="tg-token">
                  <input type="password" autoComplete="off" value={tokenIn} onChange={(e) => setTokenIn(e.target.value)} placeholder="123456789:ABC-def…" aria-label={t("tg.token")} />
                  <button
                    className="btn primary"
                    disabled={busy || !tokenIn.trim()}
                    onClick={() =>
                      void run(async () => {
                        const s = await call("POST", { token: tokenIn });
                        setTokenIn("");
                        return s;
                      })
                    }
                  >
                    {busy ? t("common.loading") : t("tg.connect")}
                  </button>
                </div>
              )}
            </li>
            <li className={st.hasToken ? "now" : ""}>
              <b>{t("tg.step3")}</b>
              <p className="note">{t("tg.step3Text")}</p>
              {st.pairLink && (
                <>
                  <a className="btn primary" href={st.pairLink} target="_blank" rel="noreferrer noopener">
                    <Icon name="send" size={16} /> {t("tg.pressStart", { bot: `@${st.botUsername ?? ""}` })}
                  </a>
                  <p className="note">{t("tg.waiting")}</p>
                </>
              )}
            </li>
          </ol>
          {st.hasToken && (
            <button className="link-btn" disabled={busy} onClick={() => void run(() => call("DELETE"))}>
              {t("tg.useAnother")}
            </button>
          )}
        </div>
      )}

      <p className="note">{t("tg.privacy")}</p>
      {st.error && <p className="msg-err">{st.error}</p>}
      {msg && <p className={msg.ok ? "msg-ok" : "msg-err"}>{msg.text}</p>}
    </>
  );
}
