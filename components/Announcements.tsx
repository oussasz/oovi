"use client";

// Announcements from the oovi team ("A new expert joined oovi"), written by the owner in HTML in
// Admin > Announcements: a bar at the top of the app (like the update bar) and/or a window. The HTML is
// shown in a locked frame (lib/announcement-frame.ts): no scripts, links open in the browser. Closing
// it is remembered on the account, so it doesn't come back on any of the person's computers.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FRAME_SANDBOX, framedHtml } from "@/lib/announcement-frame";
import { useI18n } from "./I18n";
import Icon from "./Icon";

type Item = { id: string; title: string; barText: string; html: string; window: boolean; bar: boolean; seen: boolean };
const CLOSED_KEY = "oovi.ann.closed";
const EVERY_MS = 15 * 60_000;

function closedHere(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-100) : [];
  } catch {
    return [];
  }
}

const tell = (id: string, kind: "shown" | "opened" | "closed") =>
  void fetch("/api/announcements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, kind }) }).catch(() => {});

export function Announcements() {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<Item | null>(null);
  const told = useRef(new Set<string>());
  const bar = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetch("/api/announcements")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j: { items?: Item[] }) => {
        const gone = new Set(closedHere());
        const list = (j.items ?? []).filter((x) => !gone.has(x.id));
        setItems(list);
        // A window nobody has seen yet opens by itself, once.
        const first = list.find((x) => x.window && !x.seen);
        if (first) setOpen((cur) => cur ?? first);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 4000); // after the app has settled
    const every = setInterval(load, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [load]);

  const close = (it: Item) => {
    tell(it.id, "closed");
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify([...closedHere(), it.id]));
    } catch {
      /* storage unavailable: the account remembers it */
    }
    setItems((l) => l.filter((x) => x.id !== it.id));
    setOpen((cur) => (cur?.id === it.id ? null : cur));
  };

  const barItem = items.find((x) => x.bar);
  // Counted once per announcement (the account keeps one "shown" per person anyway).
  useEffect(() => {
    for (const it of [barItem, open]) {
      if (it && !told.current.has(it.id)) {
        told.current.add(it.id);
        tell(it.id, "shown");
      }
    }
  }, [barItem, open]);

  // The app below is sized to the window minus the bars (the update bar sets --bar-h, this one --ann-h).
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = bar.current;
    if (!barItem || !el) {
      root.style.setProperty("--ann-h", "0px");
      return;
    }
    let frame = 0;
    const apply = () => root.style.setProperty("--ann-h", `${el.offsetHeight}px`);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    ro.observe(el);
    apply();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      root.style.setProperty("--ann-h", "0px");
    };
  }, [barItem]);

  // The window: Escape closes it, focus goes to it.
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(open);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {barItem && (
        <div className="update-bar ann-bar" ref={bar} role="status">
          <Icon name="spark" size={16} />
          <span className="update-text" dir="auto">
            {barItem.barText || barItem.title}
          </span>
          <div className="update-actions">
            <button
              className="btn sm"
              onClick={() => {
                tell(barItem.id, "opened");
                setOpen(barItem);
              }}
            >
              {t("ann.open")}
            </button>
            <button className="icon-btn sm" onClick={() => close(barItem)} title={t("common.close")} aria-label={t("common.close")}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      )}
      {open && (
        <div className="ann-scrim" onClick={(e) => e.target === e.currentTarget && close(open)}>
          <div className="ann-window" role="dialog" aria-modal="true" aria-label={open.title} tabIndex={-1} ref={dialog}>
            <button className="icon-btn ann-close" onClick={() => close(open)} title={t("common.close")} aria-label={t("common.close")}>
              <Icon name="close" size={18} />
            </button>
            <iframe className="ann-frame" title={open.title} sandbox={FRAME_SANDBOX} srcDoc={framedHtml(open.html)} referrerPolicy="no-referrer" />
          </div>
        </div>
      )}
    </>
  );
}
