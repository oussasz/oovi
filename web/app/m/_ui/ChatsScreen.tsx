"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { chatPreview, chatTitle, isRunning, isWaiting, listTime, matchesQuery, sortChats, type ListRow } from "../_lib/core";
import { Icon } from "./Icon";
import { ActionSheet, ChatFace, Empty, LargeTitle, NavBar, OfflineBar, Spinner, SwipeRow, TabBar, usePullToRefresh } from "./kit";
import { useM } from "./MobileApp";

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export function ChatsScreen() {
  const m = useM();
  const { t, lang, chats, sync, refresh, pins, seen, bot, refreshing } = m;
  const [q, setQ] = useState("");
  const [more, setMore] = useState<ListRow | null>(null);
  const ptr = usePullToRefresh(() => refresh({ setup: true }));

  const names = useMemo(
    () => ({ botName: (id: string) => bot(id)?.name ?? "oovi", you: t("common.you"), working: t("chats.working"), failed: t("chats.failed") }),
    [bot, t],
  );
  const rows = useMemo(() => sortChats(Object.values(chats).map((c) => c.chat), pins, seen), [chats, pins, seen]);
  const shown = useMemo(
    () =>
      q.trim()
        ? rows.filter((r) => matchesQuery(q, [chatTitle(r.chat, (id) => bot(id)?.name), ...r.chat.memberIds.map((id) => bot(id)?.name ?? ""), ...r.chat.entries.map((e) => e.text.slice(0, 2000))]))
        : rows,
    [rows, q, bot, names],
  );
  const pinned = q.trim() ? [] : shown.filter((r) => r.pinned);
  const rest = q.trim() ? shown : shown.filter((r) => !r.pinned);
  const now = Date.now();
  const off = new Date().getTimezoneOffset();
  const zone = tz();

  const row = (r: ListRow) => {
    const c = r.chat;
    const title = chatTitle(c, (id) => bot(id)?.name) || "oovi";
    const faces = c.memberIds.slice(0, 3).map((id) => bot(id)?.face ?? {});
    const running = isRunning(c);
    const waiting = isWaiting(c);
    const preview = chatPreview(c, names);
    return (
      <li key={c.id}>
        <SwipeRow
          moreLabel={t("chats.actions", { name: title })}
          onMore={() => setMore(r)}
          lead={r.unread ? { label: t("chats.read"), icon: "read", color: "var(--m-blue)", onPress: () => m.markSeen(c.id) } : { label: t("chats.unread"), icon: "unread", color: "var(--m-blue)", onPress: () => m.markUnread(c.id) }}
          trail={{ label: r.pinned ? t("chats.unpin") : t("chats.pin"), icon: "pin", color: "var(--m-orange)", onPress: () => m.togglePin(c) }}
        >
          <Link href={`/m/c/${encodeURIComponent(c.id)}`} className="m-chat" aria-label={`${title}${r.unread ? `, ${t("chats.unreadDot")}` : ""}. ${preview}`}>
            <span className={`m-chat__dot${r.unread ? " is-on" : ""}`} aria-hidden />
            <span className="m-chat__face" aria-hidden>
              <ChatFace faces={faces} size={52} mood={running ? "working" : undefined} />
            </span>
            <span className="m-chat__main">
              <span className="m-chat__top">
                <span className="m-chat__name" dir="auto">
                  {title}
                </span>
                <span className="m-chat__time">
                  {listTime(r.at, now, lang, off, zone)}
                  <Icon name="chevron" size={14} stroke={2.6} className="m-flip" />
                </span>
              </span>
              <span className="m-chat__preview" dir="auto">
                {waiting ? <span className="m-pill m-pill--warn">{t("chats.needsOk")}</span> : null}
                {running && !waiting ? <span className="m-chat__busy">{preview || t("chats.working")}</span> : preview}
              </span>
            </span>
            {r.pinned && <Icon name="pin" size={14} stroke={2} className="m-chat__pin" />}
          </Link>
        </SwipeRow>
      </li>
    );
  };

  let body: React.ReactNode;
  if (rows.length) {
    body = (
      <>
        {pinned.length > 0 && (
          <section aria-labelledby="pinned-h">
            <h2 className="m-list-head" id="pinned-h">
              {t("chats.pinned")}
            </h2>
            <ul className="m-chats">{pinned.map(row)}</ul>
          </section>
        )}
        {pinned.length > 0 && rest.length > 0 && (
          <h2 className="m-list-head" id="all-h">
            {t("chats.all")}
          </h2>
        )}
        {rest.length > 0 && <ul className="m-chats">{rest.map(row)}</ul>}
        {q.trim() && !shown.length && <p className="m-noresult">{t("chats.noResults", { q: q.trim() })}</p>}
      </>
    );
  } else if (sync === "off" || sync === "unavailable") {
    body = (
      <Empty icon={<Icon name="cloud" size={44} stroke={1.6} />} title={t("sync.off.title")} body={sync === "off" ? t("sync.off.body") : t("sync.soon.body")}>
        {sync === "off" && (
          <ol className="m-steps">
            <li>
              <Icon name="laptop" size={22} />
              <span>{t("sync.off.step1")}</span>
            </li>
            <li>
              <Icon name="settings" size={22} />
              <span>{t("sync.off.step2")}</span>
            </li>
            <li>
              <Icon name="phone" size={22} />
              <span>{t("sync.off.step3")}</span>
            </li>
          </ol>
        )}
        <button type="button" className="m-btn m-btn--tinted" onClick={() => refresh({ setup: true })} disabled={refreshing}>
          {refreshing ? <Spinner size={18} /> : t("sync.off.check")}
        </button>
      </Empty>
    );
  } else if (sync === "loading") {
    body = (
      <div className="m-center">
        <Spinner />
      </div>
    );
  } else if (sync === "error") {
    body = <Empty icon={<Icon name="warn" size={40} stroke={1.6} />} title={t("common.error")} />;
  } else {
    body = (
      <Empty icon={<Icon name="chats" size={44} stroke={1.6} />} title={t("chats.empty.title")} body={t("chats.empty.body")}>
        <Link href="/m/bots" className="m-btn m-btn--tinted">
          {t("chats.empty.cta")}
        </Link>
      </Empty>
    );
  }

  const moreChat = more?.chat;
  return (
    <div className="m-screen m-screen--tabs">
      <NavBar title={t("tab.chats")} large />
      <main className="m-main">
        {ptr}
        <LargeTitle>{t("tab.chats")}</LargeTitle>
        {rows.length > 0 && (
          <div className="m-search">
            <Icon name="search" size={18} stroke={2.1} />
            <input type="search" enterKeyHint="search" placeholder={t("chats.search")} aria-label={t("chats.search")} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
          </div>
        )}
        <OfflineBar />
        {body}
      </main>
      <TabBar />
      <ActionSheet
        open={!!more}
        title={moreChat ? chatTitle(moreChat, (id) => bot(id)?.name) : undefined}
        onClose={() => setMore(null)}
        actions={
          more && moreChat
            ? [
                { label: more.pinned ? t("chats.unpin") : t("chats.pin"), onPress: () => m.togglePin(moreChat) },
                more.unread ? { label: t("chats.read"), onPress: () => m.markSeen(moreChat.id) } : { label: t("chats.unread"), onPress: () => m.markUnread(moreChat.id) },
              ]
            : []
        }
      />
    </div>
  );
}
