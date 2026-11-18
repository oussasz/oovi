"use client";

// "Your apps" on oovi's Zapier page: the apps that are ready for the bots, one button per app to connect it in
// Zapier (it opens Zapier's page for that app), and one click to turn on every app already connected in Zapier.
// Zapier's own tools are called directly (lib/zapier.ts): no bot, no credits.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { POPULAR } from "@/lib/zapier-core";
import { useI18n } from "./I18n";
import Icon from "./Icon";

type Status = { mode: "agentic" | "classic" | "none"; ready: string[]; summary: string; manageUrl: string | null };

export default function ZapierApps({ serverId }: { serverId: string }) {
  const { t } = useI18n();
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [other, setOther] = useState("");
  const [opened, setOpened] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSt(await api<Status>(`/api/mcp/${serverId}/zapier`));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, [serverId]);
  useEffect(() => void load(), [load]);
  // Back from Zapier's page: look again.
  useEffect(() => {
    const on = () => opened && void load();
    window.addEventListener("focus", on);
    return () => window.removeEventListener("focus", on);
  }, [opened, load]);

  async function connect(app: string) {
    setBusy(app);
    setMsg(null);
    try {
      const r = await api<{ url: string }>(`/api/mcp/${serverId}/zapier`, { method: "POST", body: JSON.stringify({ op: "connect", app }) });
      window.open(r.url, "_blank", "noopener,noreferrer");
      setOpened(app);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove(app: string) {
    if (!window.confirm(t("zap.removeConfirm", { app }))) return;
    setBusy(app);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; text: string }>(`/api/mcp/${serverId}/zapier`, { method: "POST", body: JSON.stringify({ op: "remove", app }) });
      // Shown as removed only once Zapier's list says so.
      await load();
      setMsg({ ok: r.ok, text: r.ok ? t("zap.removed", { app }) : r.text });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function provision() {
    setBusy("*");
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; text: string }>(`/api/mcp/${serverId}/zapier`, { method: "POST", body: JSON.stringify({ op: "provision" }) });
      setMsg({ ok: r.ok, text: r.ok ? t("zap.provisioned") : r.text });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (!st) return <p className="note">{t("zap.loading")}</p>;
  if (st.mode === "none") return null;
  const ready = new Set(st.ready);
  return (
    <div className="zap-apps">
      <p className="note">{t("zap.intro")}</p>
      {st.ready.length > 0 && (
        <p className="zap-ready">
          <Icon name="check" size={14} /> {t("zap.ready", { apps: st.ready.join(", ") })}
        </p>
      )}
      <div className="chip-row">
        {POPULAR.map((app) =>
          ready.has(app) ? (
            <span key={app} className="chip on" title={t("zap.isReady")}>
              {busy === app ? <span className="mk-spin" aria-hidden /> : <Icon name="check" size={13} />} {app}
              {st.mode === "agentic" && (
                <button type="button" className="chip-x" disabled={!!busy} onClick={() => void remove(app)} aria-label={t("zap.remove", { app })} title={t("zap.remove", { app })}>
                  ×
                </button>
              )}
            </span>
          ) : (
            <button key={app} type="button" className="chip" disabled={!!busy} onClick={() => void connect(app)} title={t("zap.connectTitle", { app })}>
              {busy === app ? <span className="mk-spin" aria-hidden /> : <Icon name="plus" size={13} />} {app}
            </button>
          ),
        )}
      </div>
      <form
        className="zap-other"
        onSubmit={(e) => {
          e.preventDefault();
          if (other.trim()) void connect(other.trim());
        }}
      >
        <input value={other} onChange={(e) => setOther(e.target.value)} placeholder={t("zap.otherPh")} aria-label={t("zap.otherPh")} maxLength={60} />
        <button className="btn sm" disabled={!other.trim() || !!busy}>
          {t("zap.connect")}
        </button>
      </form>
      {opened && (
        <div className="notice small">
          {t("zap.opened", { app: opened })}{" "}
          <button type="button" className="btn sm" onClick={() => void load()}>
            {t("zap.refresh")}
          </button>
        </div>
      )}
      <div className="cs-act">
        {st.mode === "agentic" && (
          <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void provision()} title={t("zap.provisionTitle")}>
            {busy === "*" ? t("zap.provisioning") : t("zap.provision")}
          </button>
        )}
        {st.manageUrl && (
          <a className="btn sm" href={st.manageUrl} target="_blank" rel="noopener noreferrer">
            {t("zap.manage")} <Icon name="arrow" size={14} />
          </a>
        )}
      </div>
      {msg && <div className={`notice small${msg.ok ? "" : " error"}`}>{msg.text}</div>}
      {st.summary && (
        <details className="approval-detail">
          <summary>{t("zap.whatsOn")}</summary>
          <pre>{st.summary}</pre>
        </details>
      )}
    </div>
  );
}
