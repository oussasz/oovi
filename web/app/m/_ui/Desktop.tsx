"use client";

// The desktop app, suggested gently (owner's decision, docs/CLOUD-BUILD.md 2026-11-19): a small card in the chat
// list that can be hidden for good, a section in Settings, and a line under "This needs your computer". Never a
// pop-up, never in the way. The button opens the website's download page.
import { useEffect, useState } from "react";
import { read, write } from "../_lib/local";
import { Icon } from "./Icon";
import { useM } from "./MobileApp";

const HIDDEN = "deskHidden";

/** variant "list": the hideable card in the chat list; "card": a plain card; "line": the line under a notice. */
export function DesktopSuggestion({ variant }: { variant: "list" | "card" | "line" }) {
  const { t } = useM();
  const [hidden, setHidden] = useState(variant === "list");
  useEffect(() => {
    if (variant === "list") setHidden(read<boolean>(HIDDEN, false));
  }, [variant]);
  if (hidden) return null;
  const button = (
    <a className="m-desk__btn" href="/download" target="_blank" rel="noopener">
      <Icon name="laptop" size={18} stroke={2.2} />
      {t("desk.download")}
    </a>
  );
  if (variant === "line")
    return (
      <div className="m-desk m-desk--line">
        <p>{t("desk.more")}</p>
        {button}
      </div>
    );
  return (
    <aside className={`m-desk m-desk--${variant}`} aria-label={t("desk.title")}>
      <div className="m-desk__head">
        <b>{t("desk.title")}</b>
        {variant === "list" && (
          <button
            type="button"
            className="m-icon-btn m-desk__close"
            aria-label={t("desk.hide")}
            onClick={() => {
              write(HIDDEN, true);
              setHidden(true);
            }}
          >
            <Icon name="close" size={16} stroke={2.4} />
          </button>
        )}
      </div>
      <p>{t("desk.more")}</p>
      {button}
    </aside>
  );
}
