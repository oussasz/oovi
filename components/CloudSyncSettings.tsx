"use client";

// Settings > Sync (lib/cloud-sync.ts): one switch, off by default, with plain words on what is uploaded and what
// never leaves this computer; then the status: last sync, space used, devices, problems.
import { useCallback, useEffect, useState } from "react";
import type { CloudStatus } from "@/lib/cloud-sync";
import { timeLabel } from "@/lib/client";
import { useI18n } from "./I18n";

const mb = (bytes: number, tag: string) => `${(bytes / 1_048_576).toLocaleString(tag, { maximumFractionDigits: bytes < 10_485_760 ? 1 : 0 })} MB`;

export default function CloudSyncSettings() {
  const { t, tag } = useI18n();
  const [st, setSt] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (fresh = false) => {
    try {
      const r = await fetch(`/api/cloud${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      if (r.ok) setSt((await r.json()) as CloudStatus);
    } catch {
      /* the next refresh tries again */
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);
  // While on, the status follows the uploads and the devices (every few seconds while uploading).
  useEffect(() => {
    if (!st?.enabled) return;
    const timer = setInterval(() => void load(), st.upload ? 2000 : 10_000);
    return () => clearInterval(timer);
  }, [st?.enabled, st?.upload, load]);

  async function post(body: Record<string, unknown>, done?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/cloud", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; problem?: string; status?: CloudStatus } | null;
      if (j?.status) setSt(j.status);
      if (!r.ok || j?.ok === false) setMsg({ ok: false, text: t(`sync.problem.${j?.problem ?? "server"}` as "sync.problem.server") });
      else if (done) setMsg({ ok: true, text: done });
    } catch {
      setMsg({ ok: false, text: t("sync.problem.offline") });
    } finally {
      setBusy(false);
    }
  }

  function toggle(on: boolean) {
    if (!on && !confirm(t("sync.confirmOff"))) return;
    void post({ action: on ? "on" : "off" }, on ? t("sync.turnedOn") : t("sync.turnedOff"));
  }

  if (!st) return <p className="note">{t("common.loading")}</p>;
  if (!st.signedIn) return <p className="note">{t("sync.problem.signedOut")}</p>;
  const r = st.remote;
  const kind = (k: string) => (k === "phone" ? t("sync.device.phone") : k === "runner" ? t("sync.device.runner") : t("sync.device.desktop"));

  return (
    <>
      <p className="lead">{t("sync.lead")}</p>
      <div className="card">
        <label className="toggle">
          <input type="checkbox" checked={st.enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
          <span className="toggle-ui" />
          <span>
            <b>{t("sync.switch")}</b>
            <span className="hint">{st.enabled ? t("sync.onHint") : t("sync.offNote")}</span>
          </span>
        </label>
        {st.offElsewhere && !st.enabled && <p className="notice small">{t("sync.offElsewhere")}</p>}
        {st.enabled && st.removedConnectors.length > 0 && <p className="notice small">{t("sync.removedConnectors", { names: st.removedConnectors.join(", ") })}</p>}
        {msg && <p className={msg.ok ? "msg-ok" : "msg-err"} role="status">{msg.text}</p>}
      </div>

      <div className="card">
        <h3 className="card-h">{t("sync.what.title")}</h3>
        <ul className="plain-list">
          <li>{t("sync.what.chats")}</li>
          <li>{t("sync.what.connectors")}</li>
        </ul>
        <h3 className="card-h">{t("sync.never.title")}</h3>
        <ul className="plain-list">
          <li>{t("sync.never.keys")}</li>
          <li>{t("sync.never.local")}</li>
          <li>{t("sync.never.files")}</li>
        </ul>
        <p className="note">{t("sync.trust")}</p>
      </div>

      {st.enabled && (
        <div className="card" aria-live="polite">
          <h3 className="card-h">{t("sync.status.title")}</h3>
          {st.problem && <p className="notice error small" role="alert">{t(`sync.problem.${st.problem}`)}</p>}
          {st.upload && <p>{t("sync.uploading", { done: st.upload.done, total: st.upload.total })}</p>}
          <p>{st.lastSync ? t("sync.lastSync", { when: timeLabel(st.lastSync, tag) }) : t("sync.notYet")}</p>
          <p>{t("sync.chats", { synced: st.chats.synced, local: st.chats.localOnly })}</p>
          {r && r.limit > 0 && (
            <p>
              {t("sync.size", { used: mb(r.bytes, tag), limit: mb(r.limit, tag) })}
              <progress className="sync-meter" max={r.limit} value={Math.min(r.bytes, r.limit)} aria-hidden />
            </p>
          )}
          {st.jobs > 0 && <p>{t("sync.working")}</p>}
          {!!r?.devices.length && (
            <>
              <h4>{t("sync.devices")}</h4>
              <ul className="plain-list">
                {r.devices.map((d) => (
                  <li key={d.deviceId}>
                    <b>{kind(d.kind)}</b>
                    {d.thisOne ? ` (${t("sync.device.this")})` : ""} · {d.online ? t("sync.device.online") : t("sync.device.seen", { when: timeLabel(Date.parse(d.lastSeen), tag) })}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="row-btns">
            <button className="btn" disabled={busy} onClick={() => void post({ action: "sync" }).then(() => load(true))}>
              {t("sync.syncNow")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
