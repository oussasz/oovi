"use client";

// Settings > Safety > "Files on this computer": off, ask every time, or allowed folders.
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import "@/lib/desktop";
import { useI18n } from "./I18n";
import Icon from "./Icon";

type Mode = "off" | "ask" | "folders";
type State = { mode: Mode; folders: string[]; usual: string[]; saveFolder: string; saveDefault: string; custom: boolean };

const MODES: Mode[] = ["off", "ask", "folders"];

export default function ComputerFilesSettings() {
  const { t } = useI18n();
  const [s, setS] = useState<State | null>(null);
  const [path, setPath] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [native, setNative] = useState(false);

  useEffect(() => {
    setNative(typeof window !== "undefined" && !!window.oovi?.pickFolder);
    api<State>("/api/computer-files").then(setS).catch((e) => setErr((e as Error).message));
  }, []);

  const [savePath, setSavePath] = useState("");

  async function post(body: Record<string, string | null>) {
    setErr(null);
    try {
      setS(await api<State>("/api/computer-files", { method: "POST", body: JSON.stringify(body) }));
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  }

  async function add(p: string) {
    if (!p.trim()) return;
    if (await post({ addFolder: p.trim() })) setPath("");
  }

  async function pick() {
    const picked = await window.oovi?.pickFolder();
    if (picked) await add(picked);
  }

  async function chooseSave() {
    const picked = await window.oovi?.pickFolder(s?.saveFolder);
    if (picked) await post({ saveFolder: picked });
  }

  if (!s) return null;
  return (
    <div className="card cf-card">
      <h3 className="card-h">{t("files.title")}</h3>
      <p className="note cf-intro">{t("files.intro")}</p>
      <div className="cf-modes" role="radiogroup" aria-label={t("files.title")}>
        {MODES.map((m) => (
          <label key={m} className={`cf-mode${s.mode === m ? " on" : ""}`}>
            <input type="radio" name="cf-mode" checked={s.mode === m} onChange={() => void post({ mode: m })} />
            <span>
              <b>
                {t(`files.mode.${m}`)}
                {m === "ask" && <span className="cf-default">{t("files.default")}</span>}
              </b>
              <small>{t(`files.mode.${m}.hint`)}</small>
            </span>
          </label>
        ))}
      </div>

      {s.mode === "folders" && (
        <div className="cf-folders">
          {s.folders.length === 0 ? (
            <p className="note">{t("files.noFolders")}</p>
          ) : (
            <ul>
              {s.folders.map((f) => (
                <li key={f}>
                  <Icon name="folder" size={16} />
                  <span className="cf-path">{f}</span>
                  <button className="icon-btn sm" onClick={() => void post({ removeFolder: f })} title={t("common.remove")} aria-label={t("common.remove")}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="cf-add">
            {native ? (
              <button className="btn sm" onClick={() => void pick()}>
                <Icon name="plus" size={14} /> {t("files.addFolder")}
              </button>
            ) : (
              <>
                <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t("files.pathPlaceholder")} onKeyDown={(e) => e.key === "Enter" && void add(path)} />
                <button className="btn sm" onClick={() => void add(path)} disabled={!path.trim()}>
                  {t("files.addFolder")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {s.mode !== "off" && s.usual.length > 0 && (
        <p className="note cf-usual">
          {t("files.searches")} {s.usual.map((u) => u.split(/[\\/]/).pop()).join(", ")}
        </p>
      )}
      <div className="cf-save">
        <b>{t("files.saveTitle")}</b>
        <small className="note">{t("files.saveHint")}</small>
        <div className="cf-save-row">
          <Icon name="folder" size={16} />
          <span className="cf-path" title={s.saveFolder}>{s.saveFolder}</span>
          {!s.custom && <span className="cf-default">{t("files.default")}</span>}
        </div>
        <div className="cf-add">
          {native ? (
            <button className="btn sm" onClick={() => void chooseSave()}>
              {t("files.saveChange")}
            </button>
          ) : (
            <>
              <input value={savePath} onChange={(e) => setSavePath(e.target.value)} placeholder={t("files.pathPlaceholder")} aria-label={t("files.saveTitle")} onKeyDown={(e) => e.key === "Enter" && savePath.trim() && void post({ saveFolder: savePath.trim() }).then((ok) => ok && setSavePath(""))} />
              <button className="btn sm" onClick={() => void post({ saveFolder: savePath.trim() }).then((ok) => ok && setSavePath(""))} disabled={!savePath.trim()}>
                {t("common.save")}
              </button>
            </>
          )}
          {s.custom && (
            <button className="btn sm ghost" onClick={() => void post({ saveFolder: null })}>
              {t("files.saveReset")}
            </button>
          )}
        </div>
      </div>
      <p className="note">{t("files.never")}</p>
      {err && <div className="notice error">{err}</div>}
    </div>
  );
}
