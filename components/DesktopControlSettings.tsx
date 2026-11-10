"use client";

// Settings > Safety > "Control this computer (Beta)": what it does, the risks, an explicit
// consent box before the switch can be turned on, and "Ask before every action".
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useI18n } from "./I18n";
import Icon from "./Icon";

type State = { platform: boolean; app: boolean; appReason?: string; model: boolean; enabled: boolean; consented: boolean; askEvery: boolean };

export default function DesktopControlSettings() {
  const { t } = useI18n();
  const [s, setS] = useState<State | null>(null);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<State>("/api/desktop-control").then(setS).catch((e) => setErr((e as Error).message));
  }, []);

  async function post(body: Record<string, boolean>) {
    setErr(null);
    setBusy(true);
    try {
      setS(await api<State>("/api/desktop-control", { method: "POST", body: JSON.stringify(body) }));
      setConsent(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  const usable = s.platform && s.app;
  return (
    <div className="card dc-card">
      <h3 className="card-h">
        {t("desk.title")} <span className="dc-beta">{t("desk.beta")}</span>
      </h3>
      <p className="note dc-intro">{t("desk.intro")}</p>
      <ul className="dc-risks">
        <li>
          <Icon name="panel" size={16} /> {t("desk.risk.screen")}
        </li>
        <li>
          <Icon name="cursor" size={16} /> {t("desk.risk.input")}
        </li>
        <li className="dc-warn">
          <Icon name="shield" size={16} /> {t("desk.risk.never")}
        </li>
        <li>
          <Icon name="stop" size={16} /> {t("desk.risk.stop")}
        </li>
      </ul>

      {!s.platform ? (
        <p className="notice small">{t("desk.mac")}</p>
      ) : !s.app ? (
        <p className="notice small">{s.appReason || t("desk.noApp")}</p>
      ) : (
        <>
          {!s.model && <p className="notice small">{t("desk.noModel")}</p>}
          {!s.enabled && (
            <label className="check dc-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t("desk.consent")}</span>
            </label>
          )}
          <label className={`toggle${usable && (s.enabled || consent) && !busy ? "" : " disabled"}`}>
            <input
              type="checkbox"
              checked={s.enabled}
              disabled={!usable || busy || (!s.enabled && !consent)}
              onChange={(e) => void post(e.target.checked ? { enabled: true, consent: true } : { enabled: false })}
            />
            <span className="toggle-ui" />
            <span>
              <b>{t("desk.switch")}</b>
              <span className="hint">{s.enabled ? t("desk.on") : consent ? t("desk.offReady") : t("desk.offConsent")}</span>
            </span>
          </label>
          {s.enabled && (
            <label className="toggle">
              <input type="checkbox" checked={s.askEvery} disabled={busy} onChange={(e) => void post({ askEvery: e.target.checked })} />
              <span className="toggle-ui" />
              <span>
                <b>{t("desk.askEvery")}</b>
                <span className="hint">{s.askEvery ? t("desk.askEvery.on") : t("desk.askEvery.off")}</span>
              </span>
            </label>
          )}
        </>
      )}
      <p className="note">{t("desk.blocked")}</p>
      {err && <div className="notice error">{err}</div>}
    </div>
  );
}
