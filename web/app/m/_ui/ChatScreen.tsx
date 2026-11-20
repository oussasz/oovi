"use client";

// One chat: messages (Markdown, tables, links), what the bot is doing right now (long-poll GET /events), the
// composer (text, voice note to text), approval, question and plan cards, Stop, and "This needs your computer".
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { waitForChat, ApiError, getChat } from "../_lib/api";
import {
  agoShort,
  backoffMs,
  chatBlocker,
  lostOutgoing,
  serverState,
  chatTitle,
  computerState,
  decisionsFor,
  dmId,
  liveActivity,
  needsComputerAction,
  needsStamp,
  pendingOutgoing,
  runningEntry,
  stampLabel,
  textDir,
  bubbleTime,
  quoteOf,
  userTick,
  chatMarkdown,
  exportName,
  findInChat,
  isPinned,
  type Lang,
  type SendOptions,
} from "../_lib/core";
import { FACE_COLORS } from "@/lib/faces";
import { tap } from "../_lib/haptics";
import type { BotEntry, Chat, Entry, JobInfo, UserEntry } from "../_lib/types";

type Reply = { id: string; who: string; text: string };

/** Each bot's replies carry a wash of its own color (its face's color, the logo's pastels). */
const botColor = (face: unknown): string => {
  const i = Number((face as { color?: unknown } | undefined)?.color);
  return FACE_COLORS[Number.isInteger(i) && i >= 0 && i < FACE_COLORS.length ? i : 0]!;
};
import { Composer } from "./Composer";
import { Icon } from "./Icon";
import { ActionSheet, BotFace, ChatFace, Empty, NavBar, Spinner, usePane, useWide } from "./kit";
import { Markdown } from "./Markdown";
import { DesktopSuggestion } from "./Desktop";
import { useM } from "./MobileApp";
import { to } from "../_lib/route";

const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/**
 * A message the user can act on like in WhatsApp: long press opens its menu (Reply, Copy); a swipe toward the
 * reading direction's start (right in English, left in Arabic) replies to it. Scrolling never triggers either.
 */
function Swipeable({ children, onMenu, onReply, className }: { children: React.ReactNode; onMenu: () => void; onReply?: () => void; className?: string }) {
  const { dir } = useM();
  const sign = dir === "rtl" ? -1 : 1;
  const [dx, setDx] = useState(0);
  const st = useRef<{ x: number; y: number; lock: "h" | "v" | null; fired: boolean } | null>(null);
  const timer = useRef(0);
  const end = () => {
    window.clearTimeout(timer.current);
    const s = st.current;
    st.current = null;
    if (s?.lock === "h" && dx * sign >= 64 && onReply) {
      tap("medium");
      onReply();
    }
    setDx(0);
  };
  return (
    <div
      className={`m-swipeable${className ? ` ${className}` : ""}`}
      onTouchStart={(e) => {
        const p = e.touches[0]!;
        st.current = { x: p.clientX, y: p.clientY, lock: null, fired: false };
        timer.current = window.setTimeout(() => {
          if (st.current && !st.current.lock) {
            st.current.fired = true;
            tap("medium");
            onMenu();
          }
        }, 480);
      }}
      onTouchMove={(e) => {
        const s = st.current;
        if (!s) return;
        const p = e.touches[0]!;
        const mx = p.clientX - s.x;
        const my = p.clientY - s.y;
        if (!s.lock && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
          s.lock = Math.abs(mx) > Math.abs(my) * 1.4 && !!onReply ? "h" : "v";
          window.clearTimeout(timer.current);
        }
        if (s.lock === "h") setDx(Math.max(0, Math.min(90, mx * sign)) * sign);
      }}
      onTouchEnd={end}
      onTouchCancel={end}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu();
      }}
    >
      {onReply && (
        <span className="m-swipeable__icon" style={{ opacity: Math.min(1, Math.abs(dx) / 64) }} aria-hidden>
          <Icon name="reply" size={20} stroke={2.2} />
        </span>
      )}
      <div className={`m-swipeable__body${dx ? " is-drag" : ""}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined }}>
        {children}
      </div>
    </div>
  );
}

/** Time and ticks at the end of a bubble (WhatsApp-style). */
function Meta({ at, tick, lang, zone, t }: { at: number; tick?: "sending" | "sent" | "delivered" | "read" | "failed"; lang: Lang; zone: string; t: ReturnType<typeof useM>["t"] }) {
  return (
    <span className="m-meta">
      <time>{bubbleTime(at, lang, zone)}</time>
      {tick === "sending" && <Icon name="clock" size={13} stroke={2} />}
      {tick === "sent" && <Icon name="tick" size={14} stroke={2.2} />}
      {(tick === "delivered" || tick === "read") && <Icon name="ticks" size={16} stroke={2} className={tick === "read" ? "is-read" : ""} />}
      {tick === "failed" && <Icon name="warn" size={14} stroke={2.2} />}
      {tick && <span className="m-sr-only">{t(tick === "failed" ? "chat.notSent" : `tick.${tick}`)}</span>}
    </span>
  );
}

/**
 * theOovi's account errors (web/lib/credits.ts answers in English) in the phone's language, by the reply's errorCode;
 * null for any other error (shown as "This reply stopped: …").
 */
function hostedKey(code?: string): "chat.err.noCredits" | "chat.err.dailyLimit" | "chat.err.signedOut" | "chat.err.verify" | "chat.err.offline" | "chat.err.cloud" | null {
  if (code === "cloud_failed") return "chat.err.cloud";
  if (code === "no_credits") return "chat.err.noCredits";
  if (code === "daily_limit") return "chat.err.dailyLimit";
  if (code === "signed_out") return "chat.err.signedOut";
  if (code === "verify_email") return "chat.err.verify";
  if (code === "offline") return "chat.err.offline";
  return null;
}

export function ChatScreen({ chatId }: { chatId: string }) {
  const m = useM();
  const { t, lang, chats, bot, status, sync, online, outbox, loadChat, putChat, markSeen, job } = m;
  const cached = chats[chatId];
  const chat = cached?.chat;
  // An out-of-credits reply offers "Get more credits" when the account has a way to pay: read the credits once
  // if this phone hasn't yet (they are otherwise read on the Settings screen).
  const needsCredits = !!chat?.entries.some((e) => e.kind === "bot" && e.status === "error" && (e.errorCode === "no_credits" || e.errorCode === "daily_limit"));
  const { credits, loadCredits } = m;
  useEffect(() => {
    if (needsCredits && !credits) void loadCredits().catch(() => {});
  }, [needsCredits, credits, loadCredits]);
  const version = cached?.version ?? 0;
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">(cached ? "ok" : "loading");
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [answered, setAnswered] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [menu, setMenu] = useState<Entry | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  // The computer's chat header and composer (owner, 2026-11-19: add what's missing).
  const [chatMenu, setChatMenu] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [find, setFind] = useState<string | null>(null);
  const [findAt, setFindAt] = useState(0);
  const [opts, setOptsState] = useState<SendOptions>({});
  useEffect(() => {
    try {
      setOptsState(JSON.parse(localStorage.getItem(`oovi.m.opts.${chatId}`) || "{}") as SendOptions);
    } catch {
      /* none */
    }
  }, [chatId]);
  const setOpts = (o: SendOptions) => {
    setOptsState(o);
    try {
      localStorage.setItem(`oovi.m.opts.${chatId}`, JSON.stringify(o));
    } catch {
      /* private mode */
    }
  };
  const pane = usePane();
  const wide = useWide();
  const router = useRouter();

  // Esc: cancels a reply; on a wide screen (web) then closes the chat, like WhatsApp Web. Open menus close first.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      if (find !== null) setFind(null);
      else if (reply) setReply(null);
      else if (wide) router.push(to());
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [reply, wide, router, find]);
  const showToast = m.toast;
  const endRef = useRef<HTMLDivElement>(null);
  const firstScroll = useRef(true);
  const versionRef = useRef(version);
  versionRef.current = version;
  const runningRef = useRef(false);
  runningRef.current = !!(chat && runningEntry(chat));

  // A direct chat with a bot that has no messages yet is a new chat (the computer creates it on the first message).
  const dmBotId = chatId.startsWith("dm-") ? chatId.slice(3) : null;
  const dmBot = dmBotId ? bot(dmBotId) : undefined;
  const isNewDm = !chat && !!dmBot && dmId(dmBot.id) === chatId;
  // A group added from the phone (or one with no messages yet) opens the same way.
  const newGroup = !chat && !isNewDm ? m.setup?.groups.find((g) => g.id === chatId && g.memberIds.length) : undefined;
  const view: Chat | undefined =
    chat ??
    (isNewDm && dmBot
      ? { id: chatId, kind: "direct", name: dmBot.name, memberIds: [dmBot.id], createdAt: 0, updatedAt: 0, entries: [] }
      : newGroup
        ? { id: chatId, kind: "group", name: newGroup.name, memberIds: newGroup.memberIds, ...(newGroup.leadId ? { leadId: newGroup.leadId } : {}), createdAt: 0, updatedAt: 0, entries: [] }
        : undefined);

  const title = view ? chatTitle(view, (id) => bot(id)?.name) || "oovi" : "";
  const members = (view?.memberIds ?? []).map((id) => bot(id));
  const localBot = members.find((b) => b?.local);

  // ---------- load, then wait for each new version (long-poll) ----------
  useEffect(() => {
    let alive = true;
    void loadChat(chatId).then((r) => {
      if (alive) setState(r === "ok" ? "ok" : r === "missing" ? "missing" : cached ? "ok" : "error");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, loadChat]);

  useEffect(() => {
    if (sync !== "on") return;
    let stop = false;
    let ctrl: AbortController | null = null;
    let fails = 0;
    // Jobs that changed in the last 10 minutes come with the first answer; after that, only newer changes wake it.
    let jobsAfter: string | null = new Date(Date.now() - 10 * 60_000).toISOString();
    const loop = async () => {
      // A bot at work: live at once. Otherwise the chat was just loaded; the wait starts a moment later.
      if (!runningRef.current) await new Promise((r) => setTimeout(r, 2500));
      while (!stop) {
        if (document.visibilityState !== "visible" || !navigator.onLine) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl?.abort(), 35_000);
        try {
          const r = await waitForChat(chatId, versionRef.current, jobsAfter, ctrl.signal);
          fails = 0;
          if (stop) break;
          if (r.now) jobsAfter = r.now;
          setJobs(r.jobs);
          if (r.deleted) {
            void loadChat(chatId);
          } else if (r.version > versionRef.current) {
            const full = await getChat(chatId);
            if (full?.chat) putChat(full.version, { ...full.chat, id: chatId });
            setState("ok");
          }
        } catch (err) {
          if (stop) break;
          const aborted = (err as Error)?.name === "AbortError";
          if (err instanceof ApiError && (err.status === 401 || err.code === "sync_off")) break;
          if (!aborted) {
            fails++;
            await new Promise((r) => setTimeout(r, backoffMs(fails)));
          }
        } finally {
          window.clearTimeout(timer);
        }
      }
    };
    void loop();
    const vis = () => {
      if (document.visibilityState === "visible") void loadChat(chatId);
      else ctrl?.abort();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      stop = true;
      ctrl?.abort();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [chatId, sync, putChat, loadChat]);

  // ---------- the phone's messages and jobs ----------
  const mine = useMemo(() => pendingOutgoing(chat, outbox.filter((o) => o.chatId === chatId)), [chat, outbox, chatId]);
  // A message whose job failed on the server never gets an answer: it shows as not sent, to send again.
  const markLost = m.markLost;
  useEffect(() => {
    const lost = lostOutgoing(mine, jobs);
    if (lost.length) markLost(lost);
  }, [mine, jobs, markLost]);

  // ---------- read marks and scrolling ----------
  const entries = view?.entries ?? [];
  const lastAt = entries[entries.length - 1]?.at ?? 0;
  useEffect(() => {
    if (chat) markSeen(chatId);
  }, [chat, chatId, markSeen, lastAt]);

  const count = entries.length + mine.length;
  const matches = useMemo(() => (find ? findInChat(entries, find) : []), [entries, find]);
  const found = matches.length ? matches[Math.min(findAt, matches.length - 1)] : null;
  useEffect(() => {
    if (found) document.getElementById(`m-${found}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [found]);
  const running = view ? runningEntry(view) : undefined;
  useEffect(() => {
    const near = pane ? pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 160 : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    if (firstScroll.current && count) {
      firstScroll.current = false;
      endRef.current?.scrollIntoView({ block: "end" });
      return;
    }
    if (near) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count, running?.steps?.length, running?.text]);

  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  const pending = view?.pending;
  const answerKey = pending?.approval?.entryId ?? pending?.questions?.entryId ?? pending?.planReview?.entryId ?? null;
  useEffect(() => {
    if (answered && answered !== answerKey) setAnswered(null);
  }, [answered, answerKey]);

  const computer = computerState(status);
  const blocker = chatBlocker(view, jobs, computer.state, mine.some((o) => o.state === "sent"), serverState(status));
  // "loading": the status is on its way (first start on this phone); the box shows, sending waits for the answer.
  const canSend = (sync === "on" || sync === "loading") && !localBot;

  const decide = useCallback(
    async (key: string, payload: Parameters<typeof job>[1]) => {
      tap("success");
      setAnswered(key);
      const ok = await job(chatId, payload);
      if (ok === null) {
        setAnswered(null);
        showToast(m.lastJobError());
      }
    },
    [chatId, job, showToast, t],
  );

  const stop = async () => {
    tap("medium");
    setStopping(true);
    const ok = await job(chatId, { kind: "stop", payload: {} });
    if (ok === null) {
      setStopping(false);
      showToast(m.lastJobError());
    }
  };

  // "Download this chat (Markdown)", made here from the synced chat like the computer makes it.
  const download = () => {
    if (!view) return;
    const md = chatMarkdown(view, title, (id) => bot(id)?.name ?? "oovi");
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = exportName(title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(t("dk.downloaded"));
  };

  // ---------- header ----------
  const activity = running ? liveActivity(running, lang) : null;
  // The web version's header reads like the computer's: who is in the chat (a bot's role, a group's members).
  const who = view?.kind === "group" ? members.map((b) => b?.name).filter(Boolean).join(", ") : members[0]?.role || "";
  const sub = activity ? activity.label : wide && who ? who : computer.state === "online" ? t("chat.computerOn") : null;
  // Tapping the header (the face and name) edits the bot or the group (owner, 2026-11-19).
  const editHref = !view
    ? null
    : view.kind === "group"
      ? m.setup?.groups.some((g) => g.id === view.id)
        ? to(`/group/${encodeURIComponent(view.id)}`)
        : null
      : view.memberIds[0] && m.setup?.bots.some((b) => b.id === view.memberIds[0])
        ? to(`/bot/${encodeURIComponent(view.memberIds[0])}`)
        : null;
  const headInner = view ? (
    <>
      <span className="m-chathead__face" aria-hidden>
        <ChatFace faces={members.map((b) => b?.face ?? {})} size={40} mood={activity?.mood} />
      </span>
      <span className="m-chathead__text">
        <span className="m-chathead__name" dir="auto">
          {title}
        </span>
        {sub && <span className={`m-chathead__sub${activity ? " is-live" : ""}`}>{sub}</span>}
      </span>
    </>
  ) : null;
  const center = headInner ? (
    editHref ? (
      <Link href={editHref} className="m-chathead" aria-label={t("ed.bot.editTitle", { name: title })}>
        {headInner}
      </Link>
    ) : (
      <span className="m-chathead">{headInner}</span>
    )
  ) : null;

  // ---------- body ----------
  const now = Date.now();
  const off = new Date().getTimezoneOffset();
  const tzName = zone();
  let prevAt: number | undefined;
  const stamp = (at: number) => {
    const show = needsStamp(prevAt, at, off);
    prevAt = at;
    return show ? (
      <div className="m-stamp" key={`s${at}`}>
        {stampLabel(at, now, lang, t("common.today"), off, tzName)}
      </div>
    ) : null;
  };

  const replyFor = (e: Entry): Reply => ({ id: e.id, who: e.kind === "user" ? t("common.you") : (bot(e.botId)?.name ?? "oovi"), text: quoteOf(e.text) });
  const quote = (r: { who: string; text: string } | undefined) =>
    r ? (
      <span className="m-quote" dir="auto">
        <b>{r.who}</b>
        <span>{r.text.slice(0, 140)}</span>
      </span>
    ) : null;

  const renderUser = (e: UserEntry) => (
    <div className={`m-msg m-msg--me${found === e.id ? " is-found" : ""}`} key={e.id} id={`m-${e.id}`}>
      {stamp(e.at)}
      {(e.attachments ?? []).map((a) => (
        <div className="m-file" key={a.id}>
          <Icon name="file" size={18} />
          <span dir="auto">{t("chat.file", { name: a.name })}</span>
        </div>
      ))}
      {e.text.trim() && (
        <Swipeable onMenu={() => setMenu(e)} onReply={canSend ? () => setReply(replyFor(e)) : undefined}>
          <div className="m-bubble m-bubble--me">
            {quote(e.replyTo)}
            <p dir={textDir(e.text)}>
              {e.text}
              <Meta at={e.at} tick={view ? userTick(view, e.id) : "delivered"} lang={lang} zone={tzName} t={t} />
            </p>
          </div>
        </Swipeable>
      )}
    </div>
  );

  const renderBot = (e: BotEntry, i: number) => {
    const b = bot(e.botId);
    const name = b?.name ?? "oovi";
    const text = e.held ? "" : e.text;
    const live = e.status === "running";
    const act = live ? liveActivity(e, lang) : null;
    const next = entries[i + 1];
    const lastOfRun = !next || next.kind !== "bot" || next.botId !== e.botId;
    const firstOfRun = i === 0 || entries[i - 1]?.kind !== "bot" || (entries[i - 1] as BotEntry).botId !== e.botId;
    const showName = !wide && view?.kind === "group" && firstOfRun;
    if (!text.trim() && !live && e.status !== "error" && e.status !== "stopped") return null;
    // On a wide screen (the web version) messages read like the computer's: the face at the top, then a line with
    // the bot's name, its role and the time; on a phone, WhatsApp's way (face at the end of a run, name in groups).
    return (
      <div className={`m-msg m-msg--bot${found === e.id ? " is-found" : ""}`} key={e.id} id={`m-${e.id}`}>
        {stamp(e.at)}
        {showName && <div className="m-msg__name">{name}</div>}
        <div className={`m-msg__row${wide ? " m-msg__row--top" : ""}`}>
          {(wide ? firstOfRun : lastOfRun) && b && m.setup?.bots.some((x) => x.id === e.botId) ? (
            <Link href={to(`/bot/${encodeURIComponent(e.botId)}`)} className="m-msg__face" aria-label={t("ed.bot.editTitle", { name })} tabIndex={-1}>
              <BotFace face={b.face} size={wide ? 38 : 30} mood={act?.mood} />
            </Link>
          ) : (
            <span className="m-msg__face" aria-hidden>
              {(wide ? firstOfRun : lastOfRun) ? <BotFace face={b?.face} size={wide ? 38 : 30} mood={act?.mood} /> : null}
            </span>
          )}
          <div className="m-msg__col">
            {wide && firstOfRun && (
              <div className="m-msg__who">
                <b dir="auto">{name}</b>
                {b?.role && (
                  <span className="m-msg__role" dir="auto">
                    {b.role}
                  </span>
                )}
                <time>{bubbleTime(e.at, lang, tzName)}</time>
              </div>
            )}
            {text.trim() && (
              <Swipeable onMenu={() => setMenu(e)} onReply={canSend ? () => setReply(replyFor(e)) : undefined}>
                <div className="m-bubble m-bubble--bot" style={{ "--bot": botColor(b?.face) } as React.CSSProperties}>
                  <Markdown text={text} />
                  {!live && <Meta at={e.at} lang={lang} zone={tzName} t={t} />}
                </div>
              </Swipeable>
            )}
            {live && act && (
              <div className="m-live" role="status" aria-live="polite">
                <span className="m-typing" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span>{act.label}</span>
              </div>
            )}
            {e.status === "error" && e.errorCode !== "needs_computer" && (hostedKey(e.errorCode) ? (
              <div className="m-msg__account" role="note">
                <p>
                  <Icon name="warn" size={15} /> {t(hostedKey(e.errorCode)!)}
                </p>
                {(e.errorCode === "no_credits" || e.errorCode === "daily_limit") && m.credits?.links?.subscribe && (
                  <Link href={to("/settings")} className="m-btn m-btn--fill m-btn--sm" onClick={() => tap()}>
                    {t("settings.getMore")}
                  </Link>
                )}
                {e.errorCode === "verify_email" && (
                  <Link href={to("/settings")} className="m-btn m-btn--sm" onClick={() => tap()}>
                    {t("acct.verifyTitle")}
                  </Link>
                )}
              </div>
            ) : (
              <p className="m-msg__err">
                <Icon name="warn" size={15} /> {t("chat.error", { error: (e.error ?? t("chats.failed")).slice(0, 200) })}
              </p>
            ))}
            {e.status === "stopped" && <p className="m-msg__note">{t("chat.stopped")}</p>}
            {e.unconfirmed && <p className="m-msg__note m-msg__note--warn">{t("chat.unconfirmed")}</p>}
          </div>
        </div>
      </div>
    );
  };

  // ---------- cards ----------
  const approval = pending?.approval;
  const approvalCard = approval ? (
    <section className="m-card" aria-labelledby="ap-h">
      <div className="m-card__head">
        <BotFace face={bot(approval.botId)?.face} size={34} mood="asking" />
        <h2 id="ap-h">{t("chat.approval.title", { name: bot(approval.botId)?.name ?? "oovi" })}</h2>
      </div>
      <ul className="m-card__items">
        {approval.items.map((it) => (
          <li key={it.call.id}>
            <span dir="auto">{it.summary}</span>
            {needsComputerAction(it) && (
              <span className="m-card__hint">
                <Icon name="laptop" size={14} /> {t("chat.approval.computer")}
              </span>
            )}
            {it.detail && (
              <details>
                <summary>{t("chat.approval.details")}</summary>
                <pre dir="auto">{it.detail.slice(0, 2000)}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      {answered === approval.entryId ? (
        <p className="m-card__done">
          <Icon name="check" size={16} /> {t("chat.approval.sent")}
        </p>
      ) : (
        <div className="m-card__btns">
          <button type="button" className="m-btn m-btn--gray" onClick={() => decide(approval.entryId, { kind: "decision", payload: { decisions: decisionsFor(approval.items, false) } })}>
            {t("chat.approval.notNow")}
          </button>
          <button type="button" className="m-btn m-btn--fill" onClick={() => decide(approval.entryId, { kind: "decision", payload: { decisions: decisionsFor(approval.items, true) } })}>
            {t("chat.approval.allow")}
          </button>
        </div>
      )}
    </section>
  ) : null;

  const qEntry = pending?.questions ? (entries.find((e) => e.id === pending.questions!.entryId) as BotEntry | undefined) : undefined;
  const planEntry = pending?.planReview ? (entries.find((e) => e.id === pending.planReview!.entryId) as BotEntry | undefined) : undefined;

  const blockerCard =
    blocker === "needs_computer" ? (
      <section className="m-card m-card--computer" role="status">
        <div className="m-card__head">
          <span className="m-card__icon">
            <Icon name="laptop" size={26} />
          </span>
          <div>
            <h2>{t("chat.needsComputer.title")}</h2>
            <p>{t("chat.needsComputer.body")}</p>
          </div>
        </div>
        <p className={`m-device m-device--${computer.state}`}>
          <i aria-hidden />
          {computer.state === "online" ? t("chat.computerOn") : t("chat.computerOff", { ago: computer.lastSeen ? agoShort(computer.lastSeen, now, lang) : "–" })}
        </p>
        <DesktopSuggestion variant="line" />
      </section>
    ) : blocker === "queued_server" || blocker === "queued_offline" ? (
      <p className="m-queued" role="status">
        <Icon name="laptop" size={16} /> {t(blocker === "queued_server" ? "chat.queuedServer" : "chat.queued")}
      </p>
    ) : null;

  let main: React.ReactNode;
  if (!view && state === "loading") {
    main = (
      <div className="m-center">
        <Spinner />
      </div>
    );
  } else if (!view) {
    main = <Empty icon={<Icon name="chats" size={44} stroke={1.6} />} title={t("chat.notHere")} body={t("chat.notHereBody")} />;
  } else {
    main = (
      <div className="m-thread" aria-live="off">
        {entries.length === 0 && !mine.length && (
          <div className="m-hello">
            <BotFace face={members[0]?.face} size={84} mood="happy" />
            <h2 dir="auto">{t("chat.hello", { name: title })}</h2>
            <p>{localBot ? t("chat.local", { name: localBot.name }) : t("chat.helloBody", { name: title })}</p>
          </div>
        )}
        {entries.map((e, i) => (e.kind === "user" ? renderUser(e) : renderBot(e, i)))}
        {mine.map((o) => (
          <div className="m-msg m-msg--me" key={o.entryId}>
            {stamp(o.at)}
            <button
              type="button"
              className={`m-bubble m-bubble--me m-bubble--out is-${o.state}`}
              disabled={o.state !== "failed"}
              onClick={() => {
                tap();
                void m.retry(o.entryId);
              }}
            >
              {quote(o.replyTo)}
              <p dir={textDir(o.text)}>
                {o.text}
                <Meta at={o.at} tick={o.state} lang={lang} zone={tzName} t={t} />
              </p>
            </button>
            {o.state === "failed" && <span className="m-out is-failed">{t("chat.notSent")}</span>}
          </div>
        ))}
        {approvalCard}
        {qEntry?.questions && answered !== qEntry.id && <QuestionsCard entry={qEntry} face={bot(qEntry.botId)?.face} name={bot(qEntry.botId)?.name ?? "oovi"} onAnswer={(answers) => decide(qEntry.id, { kind: "decision", payload: { answers } })} />}
        {planEntry && answered !== planEntry.id && (
          <section className="m-card" aria-labelledby="plan-h">
            <div className="m-card__head">
              <BotFace face={bot(planEntry.botId)?.face} size={34} mood="thinking" />
              <h2 id="plan-h">{t("chat.plan.title", { name: bot(planEntry.botId)?.name ?? "oovi" })}</h2>
            </div>
            <ol className="m-card__plan">
              {(planEntry.plan ?? []).map((p, k) => (
                <li key={k} dir="auto">
                  {p.text}
                </li>
              ))}
            </ol>
            <div className="m-card__btns">
              <button type="button" className="m-btn m-btn--gray" onClick={() => decide(planEntry.id, { kind: "decision", payload: { planDecision: { approve: false, items: [] } } })}>
                {t("chat.plan.cancel")}
              </button>
              <button type="button" className="m-btn m-btn--fill" onClick={() => decide(planEntry.id, { kind: "decision", payload: { planDecision: { approve: true, items: (planEntry.plan ?? []).map((p) => p.text) } } })}>
                {t("chat.plan.start")}
              </button>
            </div>
          </section>
        )}
        {blockerCard}
      </div>
    );
  }

  return (
    <div className="m-screen m-screen--chat">
      <NavBar
        title={title}
        back={{ href: to(), label: t("tab.chats") }}
        center={center}
        solid
        right={
          view ? (
            <button type="button" className="m-nav__more" aria-label={t("dk.options")} onClick={() => (tap(), setChatMenu(true))}>
              <Icon name="more" size={24} />
            </button>
          ) : null
        }
      />
      <main className="m-main m-main--chat">
        {find !== null && (
          <div className="m-find" role="search">
            <Icon name="search" size={17} stroke={2.1} />
            <input
              autoFocus
              type="search"
              dir="auto"
              value={find}
              placeholder={t("dk.chat.findPh")}
              aria-label={t("dk.chat.find")}
              onChange={(e) => (setFind(e.target.value), setFindAt(0))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches.length) {
                  e.preventDefault();
                  setFindAt((i) => (e.shiftKey ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length));
                }
              }}
            />
            <span className="m-find__n" role="status" aria-live="polite">
              {find.trim() ? (matches.length ? t("dk.findCount", { i: String(Math.min(findAt, matches.length - 1) + 1), n: String(matches.length) }) : t("dk.findNone")) : ""}
            </span>
            <button type="button" className="m-icon-btn" aria-label={t("dk.findPrev")} disabled={!matches.length} onClick={() => setFindAt((i) => (i - 1 + matches.length) % matches.length)}>
              <Icon name="up" size={18} stroke={2.4} />
            </button>
            <button type="button" className="m-icon-btn" aria-label={t("dk.findNext")} disabled={!matches.length} onClick={() => setFindAt((i) => (i + 1) % matches.length)}>
              <Icon name="up" size={18} stroke={2.4} className="m-flipv" />
            </button>
            <button type="button" className="m-icon-btn" aria-label={t("dk.findClose")} onClick={() => setFind(null)}>
              <Icon name="close" size={16} stroke={2.4} />
            </button>
          </div>
        )}
        {main}
        <div ref={endRef} className="m-end" />
      </main>
      {view &&
        (canSend ? (
          <Composer
            placeholder={t("chat.messageTo", { name: title })}
            running={!!running || mine.some((o) => o.state === "sent")}
            stopping={stopping}
            onStop={stop}
            disabled={!online}
            onToast={showToast}
            reply={reply}
            onCancelReply={() => setReply(null)}
            opts={opts}
            onOpts={setOpts}
            onSend={async (text) => {
              tap();
              const r = reply;
              setReply(null);
              const ok = await m.send(chatId, text, r ?? undefined, opts);
              if (!ok) showToast(m.lastJobError());
              return true;
            }}
          />
        ) : (
          <div className="m-composer m-composer--note" role="note">
            <p>{localBot ? t("chat.local", { name: localBot.name }) : t("sync.off.body")}</p>
          </div>
        ))}
      <ActionSheet
        open={!!menu}
        onClose={() => setMenu(null)}
        actions={
          menu
            ? [
                ...(canSend ? [{ label: t("chat.reply"), onPress: () => setReply(replyFor(menu)) }] : []),
                {
                  label: t("common.copy"),
                  onPress: () => {
                    void navigator.clipboard?.writeText(menu.text).then(() => showToast(t("common.copied")), () => {});
                  },
                },
                // Only the computer can do these (they change its copy of the chat and what the bots learned).
                { label: t("dk.chat.fork"), sub: t("ed.onComputer"), disabled: true, onPress: () => {} },
                ...(menu.kind === "bot"
                  ? [
                      { label: t("dk.chat.good"), sub: t("ed.onComputer"), disabled: true, onPress: () => {} },
                      { label: t("dk.chat.bad"), sub: t("ed.onComputer"), disabled: true, onPress: () => {} },
                    ]
                  : []),
              ]
            : []
        }
      />
      <ActionSheet
        open={chatMenu}
        title={title}
        onClose={() => setChatMenu(false)}
        actions={
          view
            ? [
                { label: t("dk.chat.find"), onPress: () => (setFind(""), setFindAt(0)) },
                { label: isPinned(m.pins, view) ? t("dk.chat.unpin") : t("dk.chat.pin"), onPress: () => m.togglePin(view) },
                ...(view.entries.length ? [{ label: t("dk.chat.export"), onPress: download }] : []),
                ...(editHref ? [{ label: t("ed.bot.editTitle", { name: title }), onPress: () => router.push(editHref) }] : []),
                ...(chat ? [{ label: t("dk.delete"), destructive: true, onPress: () => setAskDelete(true) }] : []),
                { label: t("dk.chat.clear"), sub: t("ed.onComputer"), disabled: true, onPress: () => {} },
                { label: t("dk.cv.title"), sub: t("dk.canvasHint"), disabled: true, onPress: () => {} },
                { label: t("dk.chat.live"), sub: t("ed.onComputer"), disabled: true, onPress: () => {} },
                { label: t("dk.folder.title"), sub: t("ed.onComputer"), disabled: true, onPress: () => {} },
              ]
            : []
        }
      />
      <ActionSheet
        open={askDelete}
        message={t("chats.deleteAsk", { name: title })}
        onClose={() => setAskDelete(false)}
        actions={[
          {
            label: t("dk.delete"),
            destructive: true,
            onPress: () =>
              void m.removeChat(chatId).then((ok) => {
                showToast(ok ? t("chats.deleted") : t("create.err.save"));
                if (ok) router.replace(to());
              }),
          },
        ]}
      />
    </div>
  );
}

function QuestionsCard({ entry, face, name, onAnswer }: { entry: BotEntry; face: object | undefined; name: string; onAnswer: (answers: string[] | null) => void }) {
  const { t } = useM();
  const items = entry.questions?.items ?? [];
  const [answers, setAnswers] = useState<string[]>(() => items.map(() => ""));
  const ready = answers.every((a) => a.trim());
  return (
    <section className="m-card" aria-labelledby="q-h">
      <div className="m-card__head">
        <BotFace face={face} size={34} mood="asking" />
        <h2 id="q-h">{t("chat.questions.title", { name })}</h2>
      </div>
      {entry.questions?.intro && (
        <p className="m-card__intro" dir="auto">
          {entry.questions.intro}
        </p>
      )}
      {items.map((it, k) => (
        <fieldset className="m-q" key={k}>
          <legend dir="auto">{it.question}</legend>
          <div className="m-q__opts">
            {it.options.map((o) => (
              <button
                key={o}
                type="button"
                className={`m-chip${answers[k] === o ? " is-on" : ""}`}
                aria-pressed={answers[k] === o}
                dir="auto"
                onClick={() => {
                  tap();
                  setAnswers((a) => a.map((x, j) => (j === k ? o : x)));
                }}
              >
                {o}
              </button>
            ))}
          </div>
          <input
            className="m-input"
            dir="auto"
            placeholder={t("chat.questions.write")}
            aria-label={`${it.question} ${t("chat.questions.write")}`}
            value={it.options.includes(answers[k] ?? "") ? "" : answers[k]}
            onChange={(e) => setAnswers((a) => a.map((x, j) => (j === k ? e.target.value.slice(0, 1000) : x)))}
          />
        </fieldset>
      ))}
      <div className="m-card__btns">
        <button type="button" className="m-btn m-btn--gray" onClick={() => onAnswer(null)}>
          {t("chat.questions.skip")}
        </button>
        <button type="button" className="m-btn m-btn--fill" disabled={!ready} onClick={() => onAnswer(answers.map((a) => a.trim()))}>
          {t("chat.questions.send")}
        </button>
      </div>
    </section>
  );
}
