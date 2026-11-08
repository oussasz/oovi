"use client";

// The chat's project folder: the one folder on this computer its bots may work in.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import "@/lib/desktop";
import type { ChatWithState, Workspace } from "@/lib/types";
import { useI18n } from "./I18n";
import Icon from "./Icon";


const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export default function ProjectFolder({ chat, running, onChange }: { chat: ChatWithState; running: boolean; onChange: (c: ChatWithState) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const ws = chat.workspace;

  useEffect(() => setNative(typeof window !== "undefined" && !!window.oovi?.pickFolder), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function save(next: Workspace | null) {
    setBusy(true);
    setError(null);
    try {
      onChange(await api<ChatWithState>(`/api/chats/${chat.id}`, { method: "PUT", body: JSON.stringify({ workspace: next }) }));
      setTyped("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function choose() {
    if (!window.oovi) return;
    const picked = await window.oovi.pickFolder(ws?.path);
    if (picked) await save({ path: picked, autoEdit: picked === ws?.path ? ws.autoEdit : false });
  }

  return (
    <div className="pf" ref={box}>
      <button
        className={`icon-btn pf-btn${ws ? " set" : ""}${open ? " on" : ""}`}
        onClick={() => setOpen(!open)}
        title={ws ? `${t("folder.title")}: ${ws.path}` : t("folder.title")}
        aria-label={t("folder.title")}
        aria-expanded={open}
      >
        <Icon name="folder" />
        {ws && <span className="pf-name">{folderName(ws.path)}</span>}
      </button>

      {open && (
        <div className="pf-pop" role="dialog" aria-label={t("folder.title")}>
          <strong>{t("folder.title")}</strong>
          <p className="note">{t("folder.intro")}</p>

          {ws ? (
            <div className="pf-path" title={ws.path}>{ws.path}</div>
          ) : (
            !native && (
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("folder.pathPlaceholder")} spellCheck={false} onKeyDown={(e) => e.key === "Enter" && typed.trim() && void save({ path: typed.trim() })} />
            )
          )}

          <div className="row">
            {native ? (
              <button className="btn primary sm" onClick={() => void choose()} disabled={busy || running}>
                {ws ? t("folder.change") : t("folder.choose")}
              </button>
            ) : (
              !ws && (
                <button className="btn primary sm" onClick={() => void save({ path: typed.trim() })} disabled={busy || running || !typed.trim()}>
                  {t("folder.use")}
                </button>
              )
            )}
            {ws && (
              <button className="btn sm" onClick={() => void save(null)} disabled={busy || running}>
                {t("folder.remove")}
              </button>
            )}
          </div>

          {ws && (
            <label className="pf-check">
              <input type="checkbox" checked={!!ws.autoEdit} disabled={busy || running} onChange={(e) => void save({ path: ws.path, autoEdit: e.target.checked })} />
              <span>{t("folder.autoEdit")}</span>
            </label>
          )}

          <ul className="pf-rules">
            <li>{t("folder.ruleRead")}</li>
            <li>{ws?.autoEdit ? t("folder.ruleEditFree") : t("folder.ruleEditAsk")}</li>
            <li>{t("folder.ruleAlways")}</li>
            <li>{t("folder.ruleOutside")}</li>
          </ul>
          {running && <p className="note">{t("folder.whileRunning")}</p>}
          {error && <div className="notice error small">{error}</div>}
        </div>
      )}
    </div>
  );
}
