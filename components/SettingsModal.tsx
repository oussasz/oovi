"use client";

// Settings opens as a window floating above the app, with the app blurred behind it.
// Open it from anywhere with: window.dispatchEvent(new Event("oovi:settings")).

import { useEffect, useState } from "react";
import { useT } from "./I18n";
import Icon from "./Icon";
import SettingsForm from "./SettingsForm";

/** The tabs of the Settings window (SettingsForm checks the id again). */
export const SETTINGS_TABS = ["profile", "models", "memory", "telegram", "accounts", "search", "browser", "computer", "safety", "language", "data", "about"] as const;

/** Open Settings, optionally on one tab (e.g. "models"). */
export const openSettings = (tab?: string) => {
  if (tab && (SETTINGS_TABS as readonly string[]).includes(tab)) {
    try {
      localStorage.setItem("oovi.settings.tab", tab);
    } catch {
      /* storage unavailable */
    }
  }
  window.dispatchEvent(new Event("oovi:settings"));
};

export default function SettingsModal() {
  const [open, setOpen] = useState(false);
  // Re-mount the form on every open so it shows the tab that was asked for.
  const [key, setKey] = useState(0);
  const t = useT();

  useEffect(() => {
    const show = () => {
      setKey((k) => k + 1);
      setOpen(true);
    };
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
        <SettingsForm key={key} />
      </div>
    </div>
  );
}
