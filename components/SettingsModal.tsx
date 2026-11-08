"use client";

// Settings opens as a window floating above the app, with the app blurred behind it.
// Open it from anywhere with: window.dispatchEvent(new Event("oovi:settings")).

import { useEffect, useState } from "react";
import { useT } from "./I18n";
import Icon from "./Icon";
import SettingsForm from "./SettingsForm";

export const openSettings = () => window.dispatchEvent(new Event("oovi:settings"));

export default function SettingsModal() {
  const [open, setOpen] = useState(false);
  const t = useT();

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("oovi:settings", show);
    if (new URLSearchParams(location.search).has("settings")) setOpen(true);
    return () => window.removeEventListener("oovi:settings", show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal-window" role="dialog" aria-modal="true" aria-label={t("common.settings")}>
        <button className="icon-btn modal-close" onClick={() => setOpen(false)} aria-label={t("modal.closeSettings")} title={t("common.closeEsc")}>
          <Icon name="close" />
        </button>
        <SettingsForm />
      </div>
    </div>
  );
}
