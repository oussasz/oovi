"use client";

import { useState, type KeyboardEvent } from "react";

export type PreviewItem = { key: string; label: string; subject: string };

/** Tabs to switch between the example emails, shown in a locked-down frame. */
export function EmailPreviews({ items }: { items: PreviewItem[] }) {
  const [current, setCurrent] = useState(items[0]?.key ?? "");
  const item = items.find((i) => i.key === current) ?? items[0];
  if (!item) return null;
  const src = `/admin/email/preview?t=${encodeURIComponent(item.key)}`;

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = items.findIndex((x) => x.key === current);
    const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length]!;
    setCurrent(next.key);
    document.getElementById(`mail-tab-${next.key}`)?.focus();
  }

  return (
    <div className="mail-previews">
      <div className="adm-seg mail-tabs" role="tablist" aria-label="Emails" onKeyDown={onKey}>
        {items.map((i) => (
          <button
            key={i.key}
            id={`mail-tab-${i.key}`}
            type="button"
            role="tab"
            aria-selected={i.key === item.key}
            aria-controls="mail-panel"
            tabIndex={i.key === item.key ? 0 : -1}
            className={i.key === item.key ? "on" : undefined}
            onClick={() => setCurrent(i.key)}
          >
            {i.label}
          </button>
        ))}
      </div>
      <div id="mail-panel" role="tabpanel" aria-labelledby={`mail-tab-${item.key}`} className="mail-panel">
        <div className="mail-panel-head">
          <span>
            <span className="adm-help">Subject</span> <b>{item.subject}</b>
          </span>
          <a href={src} target="_blank" rel="noopener noreferrer" className="text-link">
            Open in a new tab
          </a>
        </div>
        <iframe key={item.key} src={src} title={`Preview: ${item.label}`} sandbox="" className="mail-frame" loading="lazy" />
      </div>
    </div>
  );
}
