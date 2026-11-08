"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Bot, ChatSummary } from "@/lib/types";
import Face, { FaceStack } from "./Face";
import Icon from "./Icon";

export default function Sidebar() {
  const pathname = usePathname();
  const [bots, setBots] = useState<Bot[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([api<Bot[]>("/api/bots"), api<ChatSummary[]>("/api/chats")]);
      setBots(b);
      setChats(c);
    } catch {
      /* keep the last good lists */
    }
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

  const face = (id: string) => bots.find((b) => b.id === id)?.face;
  const groups = chats.filter((c) => c.kind === "group");
  const dm = (botId: string) => chats.find((c) => c.id === `dm-${botId}`);

  return (
    <>
      <header className="mobile-bar">
        <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
          <Icon name={open ? "close" : "menu"} />
        </button>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <aside className={`sidebar${open ? " open" : ""}`}>
        <Link href="/" className={`side-settings side-home${pathname === "/" ? " active" : ""}`}>
          <Icon name="home" /> Home
        </Link>

        <div className="side-actions">
          <Link className="btn primary sm" href="/groups/new"><Icon name="plus" size={16} /> Group</Link>
          <Link className="btn sm" href="/bots/new"><Icon name="plus" size={16} /> Bot</Link>
        </div>

        <nav className="side-scroll" aria-label="Chats">
          <div className="side-label">Groups</div>
          {groups.length === 0 && <p className="side-empty">No groups yet. Put a few bots together and they&apos;ll work as a team.</p>}
          {groups.map((c) => (
            <Link key={c.id} href={`/c/${c.id}`} className={`side-item${pathname === `/c/${c.id}` ? " active" : ""}`}>
              <FaceStack faces={c.memberIds.map(face).filter((f): f is NonNullable<typeof f> => !!f)} size={38} moods={c.running ? ["thinking", "working", "thinking"] : undefined} />
              <span className="side-text">
                <span className="side-name">
                  {c.name}
                  {c.running && <span className="live-dot" title="Working" />}
                  {c.waiting && <span className="ask-pill">needs OK</span>}
                </span>
                <span className="side-preview">{c.preview || `${c.memberIds.length} bot${c.memberIds.length === 1 ? "" : "s"}`}</span>
              </span>
            </Link>
          ))}

          <div className="side-label">Bots</div>
          {bots.map((b) => {
            const c = dm(b.id);
            return (
              <Link key={b.id} href={`/c/dm-${b.id}`} className={`side-item${pathname === `/c/dm-${b.id}` ? " active" : ""}`}>
                <Face face={b.face} size={38} mood={c?.running ? "thinking" : c?.waiting ? "asking" : "idle"} />
                <span className="side-text">
                  <span className="side-name">
                    {b.name}
                    {c?.running && <span className="live-dot" title="Working" />}
                    {c?.waiting && <span className="ask-pill">needs OK</span>}
                  </span>
                  <span className="side-preview">{c?.preview || b.role || "Bot"}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <Link href="/settings" className={`side-settings${pathname === "/settings" ? " active" : ""}`}>
          <Icon name="gear" /> Settings
        </Link>
      </aside>
    </>
  );
}
