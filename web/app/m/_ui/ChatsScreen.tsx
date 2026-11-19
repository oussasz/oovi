"use client";

// The one list, the way people know it from WhatsApp: every chat, newest first, pinned on top, then each bot and
// group that has no chat yet ("Start a chat"). "+ Group" and "+ Bot" at the top like on the computer; the person's
// picture opens Settings. Swipe for Read/Pin and Archive/Delete, long press for the same; search inside messages.
// `archivedView` shows the archived chats (/m/archived). `side` is the web version's sidebar (like the computer's:
// Pinned, Groups and Bots, compact rows).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  chatPreview,
  chatTitle,
  chatsWithEveryone,
  isFresh,
  isRunning,
  isWaiting,
  listTime,
  liveActivity,
  matchesQuery,
  runningEntry,
  sortChats,
  splitArchived,
  unreadCount,
  type ListRow,
} from "../_lib/core";
import { tap } from "../_lib/haptics";
import { base, inApp, to } from "../_lib/route";
import type { Chat } from "../_lib/types";
import { NewBotSheet, NewGroupSheet } from "./Create";
import { DesktopSuggestion } from "./Desktop";
import { Icon } from "./Icon";
import { ActionSheet, ChatFace, Empty, LargeTitle, MeAvatar, NavBar, OfflineBar, Sheet, SlimeTrio, Spinner, SwipeRow, usePullToRefresh } from "./kit";
import { useM } from "./MobileApp";

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

// The web version (/app) always shows the sidebar look, also as one column on a narrow window (owner, 2026-11-19:
// "a responsive web app, not the mobile one").
export function ChatsScreen({ archivedView = false, side = base() === "/app" }: { archivedView?: boolean; side?: boolean }) {
  const m = useM();
  const { t, lang, chats, setup, sync, refresh, pins, seen, bot, refreshing, archived } = m;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [more, setMore] = useState<ListRow | null>(null);
  const [ask, setAsk] = useState<Chat | null>(null);
  const [adding, setAdding] = useState<"bot" | "group" | null>(null);
  const [picking, setPicking] = useState(false);
  // On a wide screen the open chat is beside the list: its row is marked.
  const here = inApp(usePathname() ?? "");
  const openId = (() => {
    if (!here.startsWith("/c/")) return null;
    try {
      return decodeURIComponent(here.slice(3));
    } catch {
      return here.slice(3);
    }
  })();
  const ptr = usePullToRefresh(() => refresh({ setup: true }));

  const names = useMemo(
    () => ({ botName: (id: string) => bot(id)?.name ?? "oovi", you: t("common.you"), working: t("chats.working"), failed: t("chats.failed") }),
    [bot, t],
  );
  // With sync off (or not there yet) nothing can be sent: only the chats this phone has, then "Not synced yet".
  const canChat = sync === "on" || sync === "loading";
  const everyone = useMemo(() => chatsWithEveryone(Object.values(chats).map((c) => c.chat), canChat ? setup : null), [chats, setup, canChat]);
  const all = useMemo(() => sortChats(everyone, pins, seen), [everyone, pins, seen]);
  const split = useMemo(() => splitArchived(all, archived), [all, archived]);
  const rows = archivedView ? split.archived : split.main;
  const query = q.trim();
  const shown = useMemo(
    () =>
      query
        ? rows.filter((r) => matchesQuery(query, [chatTitle(r.chat, (id) => bot(id)?.name), ...r.chat.memberIds.map((id) => [bot(id)?.name ?? "", bot(id)?.role ?? ""].join(" ")), ...r.chat.entries.map((e) => e.text.slice(0, 2000))]))
        : rows,
    [rows, query, bot],
  );
  const now = Date.now();
  const off = new Date().getTimezoneOffset();
  const zone = tz();
  const archivedUnread = split.archived.filter((r) => r.unread).length;
  const isGroup = (c: Chat) => c.kind === "group";
  const canDelete = (c: Chat) => !isFresh(c) || isGroup(c);

  // What a row says under its name: the last message, or for a bot or group with no chat yet its role or members.
  const freshLine = (c: Chat) =>
    isGroup(c)
      ? c.memberIds
          .map((id) => bot(id)?.name)
          .filter(Boolean)
          .join(", ")
      : bot(c.memberIds[0] ?? "")?.role || t("chats.sayHello");

  const row = (r: ListRow) => {
    const c = r.chat;
    const fresh = isFresh(c);
    const title = chatTitle(c, (id) => bot(id)?.name) || "oovi";
    const faces = c.memberIds.slice(0, 3).map((id) => bot(id)?.face ?? {});
    const running = isRunning(c);
    const waiting = isWaiting(c);
    const count = unreadCount(c, seen[c.id]);
    const live = running ? runningEntry(c) : undefined;
    const doing = live ? liveActivity(live, lang).label : "";
    const preview = fresh ? freshLine(c) : chatPreview(c, names);
    const isArch = archived.includes(c.id);
    const trail = [
      ...(fresh ? [] : [{ label: isArch ? t("chats.unarchive") : t("chats.archive"), icon: "archive" as const, color: "var(--m-blob-grey)", onPress: () => m.toggleArchive(c.id) }]),
      ...(canDelete(c) ? [{ label: t("chats.delete"), icon: "trash" as const, color: "var(--m-blob-coral)", onPress: () => setAsk(c) }] : []),
    ];
    return (
      <li key={c.id}>
        <SwipeRow
          moreLabel={t("chats.actions", { name: title })}
          onMore={() => setMore(r)}
          lead={[
            ...(fresh ? [] : [r.unread ? { label: t("chats.read"), icon: "read" as const, color: "var(--m-blue)", onPress: () => m.markSeen(c.id) } : { label: t("chats.unread"), icon: "unread" as const, color: "var(--m-blue)", onPress: () => m.markUnread(c.id) }]),
            ...(isArch ? [] : [{ label: r.pinned ? t("chats.unpin") : t("chats.pin"), icon: "pin" as const, color: "var(--m-orange)", onPress: () => m.togglePin(c) }]),
          ]}
          trail={trail}
        >
          <Link href={`${to()}/c/${encodeURIComponent(c.id)}`} className={`m-chat${side ? " m-chat--side" : ""}${fresh ? " is-fresh" : ""}${openId === c.id ? " is-open" : ""}`} aria-current={openId === c.id ? "page" : undefined}>
            <span className="m-chat__face" aria-hidden>
              <ChatFace faces={faces} size={side ? 40 : 54} mood={running ? "working" : undefined} />
            </span>
            <span className="m-chat__main">
              <span className="m-chat__top">
                <span className="m-chat__name" dir="auto">
                  {title}
                </span>
                <span className={`m-chat__time${count || r.unread ? " is-unread" : ""}`}>
                  {r.pinned && <Icon name="pin" size={13} stroke={2.2} className="m-chat__pin" />}
                  {fresh ? "" : listTime(r.at, now, lang, off, zone)}
                </span>
              </span>
              <span className="m-chat__bottom">
                <span className="m-chat__preview" dir="auto">
                  {waiting ? <span className="m-pill m-pill--warn">{t("chats.needsOk")}</span> : null}
                  {running && !waiting ? <span className="m-chat__busy">{doing || t("chats.working")}</span> : preview}
                </span>
                {count > 0 ? (
                  <span className="m-count" aria-label={t("chats.unreadCount", { n: count })}>
                    {count}
                  </span>
                ) : r.unread ? (
                  <span className="m-count m-count--dot" role="img" aria-label={t("chats.unreadDot")} />
                ) : null}
              </span>
            </span>
          </Link>
        </SwipeRow>
      </li>
    );
  };

  // Sections: on the phone one list (pinned, chats, then "Start a chat"); on the web like the computer's sidebar.
  const sections: { id: string; label: string | null; rows: ListRow[] }[] = (() => {
    if (query || archivedView) return [{ id: "all", label: null, rows: shown }];
    const pinned = shown.filter((r) => r.pinned);
    const rest = shown.filter((r) => !r.pinned);
    if (side)
      return [
        { id: "pinned", label: t("chats.pinned"), rows: pinned },
        { id: "groups", label: t("chats.groups"), rows: rest.filter((r) => isGroup(r.chat)) },
        { id: "bots", label: t("chats.bots"), rows: rest.filter((r) => !isGroup(r.chat)) },
      ];
    const started = rest.filter((r) => !isFresh(r.chat));
    const fresh = rest.filter((r) => isFresh(r.chat));
    return [
      { id: "pinned", label: t("chats.pinned"), rows: pinned },
      { id: "all", label: pinned.length ? t("chats.all") : null, rows: started },
      { id: "start", label: t("chats.start"), rows: fresh },
    ];
  })();

  let body: React.ReactNode;
  if (all.length) {
    body = (
      <>
        {!archivedView && split.archived.length > 0 && !query && (
          <Link href={to("/archived")} className="m-archrow">
            <Icon name="archive" size={22} />
            <span>{t("chats.archived")}</span>
            <span className={`m-archrow__n${archivedUnread ? " is-unread" : ""}`}>{archivedUnread || split.archived.length}</span>
          </Link>
        )}
        {sections
          .filter((s) => s.rows.length)
          .map((s) => (
            <section key={s.id} aria-labelledby={s.label ? `list-${s.id}` : undefined}>
              {s.label && (
                <h2 className="m-list-head" id={`list-${s.id}`}>
                  {s.label}
                </h2>
              )}
              <ul className="m-chats">{s.rows.map(row)}</ul>
            </section>
          ))}
        {query && !shown.length && <p className="m-noresult">{t("chats.noResults", { q: query })}</p>}
        {archivedView && !rows.length && <Empty icon={<Icon name="archive" size={40} stroke={1.6} />} title={t("chats.noArchived")} body={t("chats.archiveHow")} />}
      </>
    );
  } else if (sync === "off" || sync === "unavailable") {
    body = (
      <Empty art={<SlimeTrio mood="sleeping" />} title={t("sync.off.title")} body={sync === "off" ? t("sync.off.body") : t("sync.soon.body")}>
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
    body = <Empty art={<SlimeTrio mood="sad" />} title={t("common.error")} />;
  } else {
    body = (
      <Empty art={<SlimeTrio mood="happy" />} title={t("chats.empty.title")} body={t("chats.empty.body")}>
        <button type="button" className="m-btn m-btn--tinted" onClick={() => setAdding("bot")}>
          {t("create.botTitle")}
        </button>
      </Empty>
    );
  }

  const moreChat = more?.chat;
  const title = archivedView ? t("chats.archived") : t("tab.chats");
  const profile = (
    <Link href={to("/settings")} className={`m-profile${here.startsWith("/settings") || here.startsWith("/connectors") ? " is-on" : ""}`} aria-label={t("chats.profile")} onClick={() => tap()}>
      <MeAvatar size={side ? 34 : 38} />
    </Link>
  );
  const canAdd = sync === "on" && !archivedView;
  const adds = canAdd && (
    <div className="m-adds">
      <button type="button" className="m-btn m-btn--fill m-btn--sm" onClick={() => (tap(), setAdding("group"))} disabled={!(setup?.bots ?? []).some((b) => !b.hidden && !b.local)}>
        <Icon name="plus" size={16} stroke={2.6} /> {t("chats.addGroup")}
      </button>
      <button type="button" className="m-btn m-btn--gray m-btn--sm" onClick={() => (tap(), setAdding("bot"))}>
        <Icon name="plus" size={16} stroke={2.6} /> {t("chats.addBot")}
      </button>
      {!side && all.length > 0 && (
        <button type="button" className="m-adds__compose" aria-label={t("chats.new")} onClick={() => (tap(), setPicking(true))}>
          <Icon name="compose" size={21} stroke={2} />
        </button>
      )}
    </div>
  );
  const search = rows.length > 0 && (
    <div className="m-search">
      <Icon name="search" size={18} stroke={2.1} />
      <input type="search" enterKeyHint="search" placeholder={t("chats.search")} aria-label={t("chats.search")} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
    </div>
  );

  const startable = all.filter((r) => !archived.includes(r.chat.id));
  return (
    <div className={`m-screen${side ? " m-screen--side" : ""}${side && !archivedView ? " m-screen--sidelist" : ""}`}>
      {side && !archivedView ? (
        <header className="m-sidehead">
          <span className="m-sidehead__logo" aria-hidden>
            <SlimeTrio size={34} />
          </span>
          <b className="m-sidehead__name">oovi</b>
          {profile}
        </header>
      ) : (
        <NavBar title={title} large back={archivedView ? { href: to(), label: t("tab.chats") } : undefined} right={!archivedView ? profile : null} />
      )}
      <main className="m-main">
        {ptr}
        {!side && <LargeTitle>{title}</LargeTitle>}
        {side && archivedView && <h1 className="m-sidehead__title">{title}</h1>}
        {adds}
        {search}
        <OfflineBar />
        {!side && !archivedView && all.length > 0 && <DesktopSuggestion variant="list" />}
        {body}
        {side && !archivedView && all.length > 0 && <DesktopSuggestion variant="list" />}
      </main>
      <ActionSheet
        open={!!more}
        title={moreChat ? chatTitle(moreChat, (id) => bot(id)?.name) : undefined}
        onClose={() => setMore(null)}
        actions={
          more && moreChat
            ? [
                { label: more.pinned ? t("chats.unpin") : t("chats.pin"), onPress: () => m.togglePin(moreChat) },
                ...(isFresh(moreChat)
                  ? []
                  : [
                      more.unread ? { label: t("chats.read"), onPress: () => m.markSeen(moreChat.id) } : { label: t("chats.unread"), onPress: () => m.markUnread(moreChat.id) },
                      { label: archived.includes(moreChat.id) ? t("chats.unarchive") : t("chats.archive"), onPress: () => m.toggleArchive(moreChat.id) },
                    ]),
                ...(canDelete(moreChat) ? [{ label: t("chats.delete"), destructive: true, onPress: () => setAsk(moreChat) }] : []),
              ]
            : []
        }
      />
      <ActionSheet
        open={!!ask}
        message={ask ? t("chats.deleteAsk", { name: chatTitle(ask, (id) => bot(id)?.name) || "oovi" }) : undefined}
        onClose={() => setAsk(null)}
        actions={
          ask
            ? [
                {
                  label: t("chats.delete"),
                  destructive: true,
                  onPress: () => {
                    const c = ask;
                    void m.removeChat(c.id).then((ok) => {
                      m.toast(ok ? t("chats.deleted") : t("create.err.save"));
                      if (ok && openId === c.id) router.push(to());
                    });
                  },
                },
              ]
            : []
        }
      />
      <NewBotSheet open={adding === "bot"} onClose={() => setAdding(null)} />
      <NewGroupSheet open={adding === "group"} onClose={() => setAdding(null)} />
      <Sheet open={picking} title={t("chats.start")} onClose={() => setPicking(false)}>
        <ul className="m-chats m-chats--pick">
          {startable.map((r) => {
            const c = r.chat;
            return (
              <li key={c.id}>
                <Link href={`${to()}/c/${encodeURIComponent(c.id)}`} className="m-chat" onClick={() => setPicking(false)}>
                  <span className="m-chat__face" aria-hidden>
                    <ChatFace faces={c.memberIds.slice(0, 3).map((id) => bot(id)?.face ?? {})} size={44} />
                  </span>
                  <span className="m-chat__main">
                    <span className="m-chat__name" dir="auto">
                      {chatTitle(c, (id) => bot(id)?.name) || "oovi"}
                    </span>
                    <span className="m-chat__preview" dir="auto">
                      {isGroup(c) ? freshLine(c) : bot(c.memberIds[0] ?? "")?.role || ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </div>
  );
}
