"use client";

// Cloud sync's one question (lib/cloud-sync.ts), asked once: in the first-run screens for new users, and once after
// the update for people who already use oovi (this window). Also asks for a sync when the app window gets the focus,
// so the phone's changes show at once.
import { useEffect, useState } from "react";
import { useI18n } from "./I18n";

type Status = { signedIn: boolean; enabled: boolean; asked: boolean };

/** The question itself (also the last first-run screen). onDone: after the answer was saved. */
export function CloudQuestion({ onDone }: { onDone: (choice: "cloud" | "local") => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function answer(choice: "cloud" | "local") {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/cloud", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "answer", choice }) });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; problem?: string } | null;
      if (!r.ok || j?.ok === false) {
        setErr(t(`sync.problem.${j?.problem ?? "server"}` as "sync.problem.server"));
        return;
      }
      onDone(choice);
    } catch {
      setErr(t("sync.problem.offline"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cloud-ask">
      <h2 id="cloud-ask-title">{t("ask.title")}</h2>
      <p>{t("ask.body")}</p>
      <ul className="plain-list">
        <li>{t("sync.what.chats")}</li>
        <li>{t("sync.never.keys")}</li>
      </ul>
      {err && <p className="notice error small" role="alert">{err}</p>}
      <div className="row-btns">
        <button className="btn primary" disabled={busy} aria-busy={busy} onClick={() => void answer("cloud")}>{t("ask.on")}</button>
        <button className="btn" disabled={busy} onClick={() => void answer("local")}>{t("ask.local")}</button>
      </div>
      <p className="note">{t("ask.later")}</p>
    </div>
  );
}

/** In the app: the question once (if never answered), and a sync when the window gets the focus. */
export default function CloudAsk() {
  const [st, setSt] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/cloud", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
      .then(setSt)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!st?.enabled) return;
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 10_000) return;
      last = Date.now();
      void fetch("/api/cloud", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sync" }) })
        .then(() => window.dispatchEvent(new Event("oovi:refresh")))
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [st?.enabled]);

  if (!st || !st.signedIn || st.asked) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal-window cloud-ask-window" role="dialog" aria-modal="true" aria-labelledby="cloud-ask-title">
        <CloudQuestion onDone={(c) => setSt({ ...st, asked: true, enabled: c === "cloud" })} />
      </div>
    </div>
  );
}
