"use client";

// Ctrl+K (⌘K on Mac): go anywhere by typing — a chat, a bot, a page, a setting — or search every message.
import { useEffect, useMemo, useRef, useState } from "react";
import { fold } from "@/lib/chat-basics-core";
import type { Bot, ChatSummary } from "@/lib/types";
import Face from "./Face";
import { useT } from "./I18n";
import Icon, { type IconName } from "./Icon";

type Item = { key: string; label: string; hint?: string; icon?: IconName; bot?: Bot; run: () => void };

export default function CommandPalette(props: { bots: Bot[]; chats: ChatSummary[]; go: (path: string) => void; settings: () => void; searchMessages: (q: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (!o) back.current = document.activeElement as HTMLElement | null;
          return !o;
        });
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const close = () => {
    setOpen(false);
    back.current?.focus?.();
  };

  const items = useMemo<Item[]>(() => {
    const { bots, chats, go } = props;
    const all: Item[] = [
      ...bots.filter((b) => !b.hidden || chats.some((c) => c.id === `dm-${b.id}` && c.preview)).map((b) => ({ key: `b:${b.id}`, label: b.name, hint: b.role, bot: b, run: () => go(`/c/dm-${b.id}`) })),
      ...chats.filter((c) => c.kind === "group" || c.fork).map((c) => ({ key: `c:${c.id}`, label: c.name, hint: t(c.fork ? "pal.copy" : "pal.group"), icon: "user" as IconName, run: () => go(`/c/${c.id}`) })),
      { key: "p:home", label: t("side.home"), icon: "home", run: () => go("/") },
      { key: "p:group", label: t("pal.newGroup"), icon: "plus", run: () => go("/groups/new") },
      { key: "p:bot", label: t("pal.newBot"), icon: "plus", run: () => go("/bots/new") },
      { key: "p:routines", label: t("side.routines"), icon: "clock", run: () => go("/routines") },
      { key: "p:market", label: t("common.skillsTools"), icon: "library", run: () => go("/library") },
      { key: "p:settings", label: t("common.settings"), icon: "gear", run: () => props.settings() },
    ];
    const words = fold(q).split(/\s+/).filter(Boolean);
    const shown = words.length ? all.filter((i) => ((f) => words.every((w) => f.includes(w)))(fold(`${i.label} ${i.hint ?? ""}`))) : all;
    if (q.trim().length >= 2) shown.push({ key: "s:messages", label: t("pal.searchMessages", { q: q.trim() }), icon: "search", run: () => props.searchMessages(q.trim()) });
    return shown.slice(0, 40);
  }, [props, q, t]);

  if (!open) return null;
  const pick = (i?: Item) => {
    if (!i) return;
    setOpen(false);
    i.run();
  };
  const cur = Math.min(sel, Math.max(0, items.length - 1));
  return (
    <div className="pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pal" role="dialog" aria-modal="true" aria-label={t("pal.title")}>
        <div className="pal-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            dir="auto"
            value={q}
            placeholder={t("pal.ph")}
            aria-label={t("pal.title")}
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={items[cur] ? `pal-${cur}` : undefined}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => (items.length ? (s + 1) % items.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => (items.length ? (s - 1 + items.length) % items.length : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(items[cur]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="pal-list" className="pal-list" role="listbox">
          {items.length === 0 && <li className="pal-empty">{t("pal.none")}</li>}
          {items.map((i, n) => (
            <li key={i.key} id={`pal-${n}`} role="option" aria-selected={n === cur} className={n === cur ? "on" : ""} onMouseEnter={() => setSel(n)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
              {i.bot ? <Face face={i.bot.face} size={24} /> : <span className="pal-ic">{i.icon && <Icon name={i.icon} size={16} />}</span>}
              <span className="pal-label" dir="auto">{i.label}</span>
              {i.hint && <span className="pal-hint">{i.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
