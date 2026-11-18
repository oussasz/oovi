"use client";

// The first hour with oovi, on Home: connect email and calendar, then one click for up to 3 draft replies and
// today's brief from the Chief. Nothing is ever sent: the task says to write drafts only. Hidden once used or
// dismissed (remembered on this computer; it shows again only if storage is cleared).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Bot } from "@/lib/types";
import { useI18n } from "./I18n";
import Icon from "./Icon";

const KEY = "oovi.firstHour";
/** Connectors that reach email and calendars (directly, or through Zapier / Pipedream). */
const MAIL = /zapier|pipedream|gmail|google|outlook|microsoft|office|mail|calendar/i;

export default function FirstHour({ chief }: { chief: Bot }) {
  const { t } = useI18n();
  const router = useRouter();
  const [hidden, setHidden] = useState(true);
  const [mail, setMail] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === "done");
    } catch {
      setHidden(false);
    }
    api<{ name: string; url?: string; enabled: boolean; signedIn?: boolean; bots?: string[] }[]>("/api/mcp")
      .then((list) => setMail(list.some((s) => s.enabled && s.signedIn !== false && MAIL.test(`${s.name} ${s.url ?? ""}`) && (!s.bots || s.bots.includes(chief.id)))))
      .catch(() => setMail(false));
  }, [chief.id]);

  const viaBrowser = !!chief.tools.accounts;
  const ready = !!mail || viaBrowser;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, "done");
    } catch {
      /* storage unavailable */
    }
  };

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/chats/dm-${chief.id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t("fh.task") }) });
      if (!r.ok && r.status !== 202) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || t("home.sendFailed"));
      void r.body?.cancel().catch(() => {});
      close();
      router.push(`/c/dm-${chief.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (hidden || mail === null) return null;
  return (
    <section className="first-hour" aria-labelledby="fh-title">
      <button type="button" className="icon-btn sm fh-close" onClick={close} aria-label={t("fh.hide")} title={t("fh.hide")}>
        <Icon name="close" size={15} />
      </button>
      <h2 id="fh-title">{t("fh.title")}</h2>
      <p>{t("fh.sub", { name: chief.name })}</p>
      <ol>
        <li className={ready ? "done" : ""}>
          <span className="fh-n">{ready ? <Icon name="check" size={14} /> : 1}</span>
          <div>
            <b>{t("fh.step1")}</b>
            {ready ? (
              <span className="fh-hint">{t(mail ? "fh.connected" : "fh.viaBrowser")}</span>
            ) : (
              <span className="fh-hint">
                {t("fh.step1Hint")}{" "}
                <Link href="/library?tab=connectors&item=zapier">{t("fh.connect")}</Link>
              </span>
            )}
          </div>
        </li>
        <li>
          <span className="fh-n">2</span>
          <div>
            <b>{t("fh.step2")}</b>
            <span className="fh-hint">{t("fh.step2Hint")}</span>
            <div>
              <button type="button" className="btn primary sm" disabled={!ready || busy} onClick={() => void start()} aria-busy={busy}>
                <Icon name="spark" size={15} /> {t("fh.go")}
              </button>
            </div>
          </div>
        </li>
      </ol>
      {err && <div className="notice error small">{err}</div>}
    </section>
  );
}
