"use client";

// Editing a bot or a group opens as a window above the app (like Settings), with a close button and Esc.
// Open it from anywhere with openEditor("bot" | "group", id) ("new" for a new one).

import { useEffect, useState } from "react";
import BotEditor from "./BotEditor";
import GroupEditor from "./GroupEditor";
import { useT } from "./I18n";
import Icon from "./Icon";

type Target = { kind: "bot" | "group"; id: string };

export const openEditor = (kind: "bot" | "group", id: string) => window.dispatchEvent(new CustomEvent<Target>("oovi:edit", { detail: { kind, id } }));

export default function EditorModal() {
  const [target, setTarget] = useState<Target | null>(null);
  const [key, setKey] = useState(0);
  const t = useT();

  useEffect(() => {
    const show = (e: Event) => {
      const d = (e as CustomEvent<Target>).detail;
      if (!d || (d.kind !== "bot" && d.kind !== "group") || !/^[\w-]{1,80}$/.test(d.id)) return;
      setKey((k) => k + 1);
      setTarget(d);
    };
    window.addEventListener("oovi:edit", show);
    return () => window.removeEventListener("oovi:edit", show);
  }, []);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTarget(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);

  if (!target) return null;
  const close = () => setTarget(null);
  const label = target.kind === "bot" ? (target.id === "new" ? t("common.newBot") : t("chat.editBot")) : target.id === "new" ? t("common.newGroup") : t("chat.editGroup");
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal-window editor-window" role="dialog" aria-modal="true" aria-label={label}>
        <button className="icon-btn modal-close" onClick={close} aria-label={t("common.close")} title={t("common.closeEsc")}>
          <Icon name="close" />
        </button>
        {target.kind === "bot" ? <BotEditor key={key} id={target.id} onClose={close} /> : <GroupEditor key={key} id={target.id} onClose={close} />}
      </div>
    </div>
  );
}
