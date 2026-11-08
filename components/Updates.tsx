"use client";

// Update bar at the top of the app, and the Updates card in Settings > About.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { desktop, type UpdateState } from "@/lib/desktop";
import { useI18n } from "./I18n";
import Icon from "./Icon";

const HIDE_KEY = "oovi.update.later";

/** Live update state from the desktop app; null in a plain browser. */
export function useUpdates(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const u = desktop()?.updates;
    if (!u) return;
    let alive = true;
    void u.get().then((s) => alive && s && setState(s));
    const off = u.onChange((s) => setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

function errorKey(code: string | null) {
  return code === "offline" ? "update.errorOffline" : code === "damaged" ? "update.errorDamaged" : "update.errorFailed";
}

/** Thin bar above everything when a new version is out. */
export function UpdateBanner() {
  const { t } = useI18n();
  const s = useUpdates();
  const bar = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem(HIDE_KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const show =
    !!s &&
    !!s.version &&
    hidden !== s.version &&
    (s.status === "available" || s.status === "downloading" || s.status === "ready" || (s.status === "error" && tried));

  // The app below is sized to the window minus this bar.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!show || !bar.current) {
      root.style.setProperty("--bar-h", "0px");
      return;
    }
    const el = bar.current;
    const ro = new ResizeObserver(() => root.style.setProperty("--bar-h", `${el.offsetHeight}px`));
    ro.observe(el);
    root.style.setProperty("--bar-h", `${el.offsetHeight}px`);
    return () => {
      ro.disconnect();
      root.style.setProperty("--bar-h", "0px");
    };
  }, [show]);

  if (!show || !s) return null;

  const later = () => {
    setHidden(s.version);
    try {
      sessionStorage.setItem(HIDE_KEY, s.version ?? "");
    } catch {
      /* storage unavailable */
    }
  };
  const start = () => {
    setTried(true);
    void desktop()?.updates?.start();
  };

  let text: string;
  let action: React.ReactNode = null;
  if (s.status === "downloading") {
    text = t("update.downloading", { version: s.version ?? "", progress: s.progress });
  } else if (s.status === "ready") {
    text = t("update.ready", { version: s.version ?? "" });
    action = (
      <button className="btn primary sm" onClick={start}>
        {t("update.restart")}
      </button>
    );
  } else if (s.status === "error") {
    text = t(errorKey(s.error));
    action = (
      <button className="btn primary sm" onClick={start}>
        {t("update.retry")}
      </button>
    );
  } else {
    text = `${t("update.available", { version: s.version ?? "" })} ${t("update.keepsData")}`;
    action = (
      <button className="btn primary sm" onClick={start}>
        {s.canInstall ? t("update.now") : t("update.download")}
      </button>
    );
  }

  return (
    <div className="update-bar" ref={bar} role="status">
      <Icon name="spark" size={16} />
      <span className="update-text">{text}</span>
      {s.status === "downloading" && (
        <span className="update-progress" aria-hidden>
          <i style={{ width: `${s.progress}%` }} />
        </span>
      )}
      <div className="update-actions">
        {action}
        <a className="btn sm" href={s.notesUrl} target="_blank" rel="noreferrer noopener">
          {t("update.whatsNew")}
        </a>
        {s.status !== "downloading" && (
          <button className="icon-btn sm" onClick={later} title={t("update.later")} aria-label={t("update.later")}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Settings > About: version, check now, automatic updates. */
export function UpdateCard() {
  const { t } = useI18n();
  const s = useUpdates();
  if (!s) return null;
  const u = desktop()?.updates;

  let line = "";
  if (s.status === "checking") line = t("update.checking");
  else if (s.status === "available") line = t("update.available", { version: s.version ?? "" });
  else if (s.status === "downloading") line = t("update.downloading", { version: s.version ?? "", progress: s.progress });
  else if (s.status === "ready") line = t("update.ready", { version: s.version ?? "" });
  else if (s.status === "error") line = t(errorKey(s.error));
  else if (s.status === "none") line = t("update.upToDate");

  return (
    <div className="card">
      <h3 className="card-h">{t("update.title")}</h3>
      <p className="note">
        {t("update.current", { version: s.current })} {line}
      </p>
      <div className="row-btns">
        {(s.status === "available" || s.status === "ready" || (s.status === "error" && !!s.version)) && (
          <button className="btn primary" onClick={() => void u?.start()}>
            {s.status === "ready" ? t("update.restart") : s.canInstall ? t("update.now") : t("update.download")}
          </button>
        )}
        <button className="btn" onClick={() => void u?.check()} disabled={s.status === "checking" || s.status === "downloading"}>
          {t("update.check")}
        </button>
      </div>
      {s.canInstall ? (
        <label className="check">
          <input type="checkbox" checked={s.auto} onChange={(e) => void u?.setAuto(e.target.checked)} />
          <span>
            {t("update.auto")}
            <br />
            <small className="muted">{t("update.autoHint")}</small>
          </span>
        </label>
      ) : (
        <p className="note">{s.platform === "darwin" ? t("update.macNote") : t("update.manualNote")}</p>
      )}
    </div>
  );
}
