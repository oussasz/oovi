"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { desktop } from "@/lib/desktop";
import type { Bot, ChatSummary } from "@/lib/types";
import Face, { FaceStack } from "./Face";
import { useT } from "./I18n";
import Icon from "./Icon";
import { openSettings } from "./SettingsModal";
import { CreditsChip, FeedbackButton, OfflineBanner } from "./Credits";
import CommandPalette from "./CommandPalette";
import { openEditor } from "./EditorModal";

type SearchHit = { chatId: string; entryId: string; who: string; snippet: string; at: number; chat: string };

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [bots, setBots] = useState<Bot[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chiefId, setChiefId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const t = useT();
  // Search across every chat (Ctrl+K in a chat opens it too): results replace the list while there's a query.
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => setHits(r.hits))
        .catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setOpen(true);
        (document.getElementById("side-search") as HTMLInputElement | null)?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const openHit = (h: SearchHit) => {
    const path = `/c/${h.chatId}`;
    if (pathname === path) location.hash = `m-${h.entryId}`;
    else router.push(`${path}#m-${h.entryId}`);
    setOpen(false);
  };

  // Whether hidden bots are listed: remembered on this computer (a convenience; fine if storage is off).
  useEffect(() => {
    try {
      setShowHidden(localStorage.getItem("oovi.showHiddenBots") === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleHidden = () =>
    setShowHidden((v) => {
      try {
        localStorage.setItem("oovi.showHiddenBots", v ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !v;
    });

  const load = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([api<Bot[]>("/api/bots"), api<ChatSummary[]>("/api/chats")]);
      setBots(b);
      setChats(c);
    } catch {
      /* keep the last good lists */
    }
    // The Chief (main bot) is pinned first in the Bots list.
    api<{ botId: string | null }>("/api/main")
      .then((m) => setChiefId(m.botId))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener("oovi:refresh", on);
    return () => window.removeEventListener("oovi:refresh", on);
  }, [load]);

  // While any chat is busy, keep faces and previews fresh.
  const busy = chats.some((c) => c.running);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  useEffect(() => setOpen(false), [pathname]);

  // The desktop app opens a chat when its notification is clicked (e.g. a routine's result).
  useEffect(
    () =>
      desktop()?.onNavigate?.((p) => {
        if (/^\/(c\/[\w-]{1,80}|routines)$/.test(p)) router.push(p);
      }),
    [router],
  );

  const face = (id: string) => bots.find((b) => b.id === id)?.face;
  const pinnedList = chats.filter((c) => c.pinned);
  const groups = chats.filter((c) => c.kind === "group" && !c.pinned);
  const copies = chats.filter((c) => c.kind === "direct" && c.fork && !c.pinned);
  const chatRow = (c: ChatSummary) => (
    <Link key={c.id} href={`/c/${c.id}`} className={`side-item${pathname === `/c/${c.id}` ? " active" : ""}`}>
      {c.memberIds.length > 1 ? (
        <FaceStack faces={c.memberIds.map(face).filter((f): f is NonNullable<typeof f> => !!f)} size={38} moods={c.running ? ["thinking", "working", "thinking"] : undefined} />
      ) : (
        (() => {
          const f = face(c.memberIds[0] ?? "");
          return f ? <Face face={f} size={38} mood={c.running ? "thinking" : c.waiting ? "asking" : "idle"} /> : null;
        })()
      )}
      <span className="side-text">
        <span className="side-name">
          {c.name}
          {c.pinned && <Icon name="pin" size={12} className="side-pin" />}
          {c.running && <span className="live-dot" title={t("side.working")} />}
          {c.waiting && <span className="ask-pill">{t(c.asking ? "side.question" : "side.needsOk")}</span>}
        </span>
        <span className="side-preview" dir="auto">{c.preview || t("side.botCount", { count: c.memberIds.length })}</span>
      </span>
    </Link>
  );
  const dm = (botId: string) => chats.find((c) => c.id === `dm-${botId}`);
  const chief = bots.find((b) => b.id === chiefId);
  const ordered = chief ? [chief, ...bots.filter((b) => b !== chief)] : bots;
  // Hidden bots work in their groups but stay out of this list (the Chief, an open chat, or one
  // working or waiting for the user's OK always shows).
  const hiddenBots = ordered.filter((b) => b.hidden && b !== chief);
  const botList = ordered.filter((b) => !b.hidden || b === chief || showHidden || pathname === `/c/dm-${b.id}` || dm(b.id)?.waiting || dm(b.id)?.running);

  return (
    <>
      <header className="mobile-bar">
        <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={t("side.menu")} aria-expanded={open}>
          <Icon name={open ? "close" : "menu"} />
        </button>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <OfflineBanner />
      <CommandPalette
        bots={bots}
        chats={chats}
        go={(p) => router.push(p)}
        settings={() => openSettings()}
        searchMessages={(query) => {
          setOpen(true);
          setQ(query);
          setTimeout(() => (document.getElementById("side-search") as HTMLInputElement | null)?.focus(), 0);
        }}
      />
      <aside className={`sidebar${open ? " open" : ""}`}>
        <Link href="/" className={`side-settings side-home${pathname === "/" ? " active" : ""}`}>
          <Icon name="home" /> {t("side.home")}
        </Link>

        <div className="side-actions">
          <Link className="btn primary sm" href="/groups/new" onClick={(e) => (e.preventDefault(), openEditor("group", "new"))}><Icon name="plus" size={16} /> {t("side.group")}</Link>
          <Link className="btn sm" href="/bots/new" onClick={(e) => (e.preventDefault(), openEditor("bot", "new"))}><Icon name="plus" size={16} /> {t("side.bot")}</Link>
        </div>

        <div className="side-search">
          <Icon name="search" size={15} />
          <input id="side-search" type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} placeholder={t("side.search")} aria-label={t("side.search")} />
        </div>

        {hits !== null ? (
          <nav className="side-scroll side-results" aria-label={t("side.results")}>
            <div className="side-label">{t("side.results")}</div>
            {hits.length === 0 && <p className="side-empty">{t("side.noResults")}</p>}
            {hits.map((h) => (
              <button key={`${h.chatId}:${h.entryId}`} type="button" className="side-hit" onClick={() => openHit(h)}>
                <span className="side-hit-head">
                  <b>{h.chat}</b> · {h.who === "You" ? t("chat.you") : h.who}
                </span>
                <span className="side-hit-text" dir="auto">{h.snippet}</span>
              </button>
            ))}
          </nav>
        ) : (
        <nav className="side-scroll" aria-label={t("side.chats")}>
          {pinnedList.length > 0 && (
            <>
              <div className="side-label">{t("side.pinned")}</div>
              {pinnedList.map(chatRow)}
            </>
          )}
          <div className="side-label">{t("common.groups")}</div>
          {groups.length === 0 && <p className="side-empty">{t("side.noGroups")}</p>}
          {groups.map(chatRow)}
          {copies.length > 0 && (
            <>
              <div className="side-label">{t("side.copies")}</div>
              {copies.map(chatRow)}
            </>
          )}

          <div className="side-label">{t("common.bots")}</div>
          {botList.map((b) => {
            const c = dm(b.id);
            return (
              <Link key={b.id} href={`/c/dm-${b.id}`} className={`side-item${pathname === `/c/dm-${b.id}` ? " active" : ""}`}>
                <Face face={b.face} size={38} mood={c?.running ? "thinking" : c?.waiting ? "asking" : "idle"} />
                <span className="side-text">
                  <span className="side-name">
                    {b.name}
                    {b === chief && <span className="chief-tag" title={t("chief.what")}>{t("chief.title")}</span>}
                    {c?.running && <span className="live-dot" title={t("side.working")} />}
                    {c?.waiting && <span className="ask-pill">{t(c.asking ? "side.question" : "side.needsOk")}</span>}
                  </span>
                  <span className="side-preview" dir="auto">{c?.preview || b.role || t("common.bot")}</span>
                </span>
              </Link>
            );
          })}
          {hiddenBots.length > 0 && (
            <button type="button" className="side-more" onClick={() => toggleHidden()} aria-expanded={showHidden}>
              <Icon name="chevron" size={14} /> {showHidden ? t("side.hideHidden") : t("side.showHidden", { count: hiddenBots.length })}
            </button>
          )}
        </nav>
        )}

        <CreditsChip />
        <Link href="/routines" className={`side-settings side-lib${pathname === "/routines" ? " active" : ""}`}>
          <Icon name="clock" /> {t("side.routines")}
        </Link>
        <Link href="/library" className={`side-settings side-lib${pathname === "/library" ? " active" : ""}`}>
          <Icon name="library" /> {t("common.skillsTools")}
        </Link>
        <FeedbackButton />
        <button type="button" className="side-settings" onClick={() => openSettings()}>
          <Icon name="gear" /> {t("common.settings")}
        </button>
      </aside>
    </>
  );
}
