"use client";

// One chat: messages (Markdown, tables, links), what the bot is doing right now (long-poll GET /events), the
// composer (text, voice note to text), approval, question and plan cards, Stop, and "This needs your computer".
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { waitForChat, ApiError, getChat } from "../_lib/api";
import {
  agoShort,
  backoffMs,
  chatBlocker,
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
} from "../_lib/core";
import { tap } from "../_lib/haptics";
import type { BotEntry, Chat, Entry, JobInfo, UserEntry } from "../_lib/types";
import { Composer } from "./Composer";
import { Icon } from "./Icon";
import { ActionSheet, BotFace, ChatFace, Empty, NavBar, Spinner } from "./kit";
import { Markdown } from "./Markdown";
import { useM } from "./MobileApp";

const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** Long-press on a bubble opens its menu (Copy). Movement cancels it, so scrolling never triggers it. */
function useLongPress(onLong: () => void) {
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const p = e.touches[0]!;
      start.current = { x: p.clientX, y: p.clientY };
      timer.current = window.setTimeout(() => {
        tap("medium");
        onLong();
      }, 480);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const p = e.touches[0]!;
      if (start.current && Math.hypot(p.clientX - start.current.x, p.clientY - start.current.y) > 8) window.clearTimeout(timer.current);
    },
    onTouchEnd: () => window.clearTimeout(timer.current),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onLong();
    },
  };
}

function Bubble({ entry, children, mine, onMenu, className }: { entry: Entry; children: React.ReactNode; mine: boolean; onMenu: (e: Entry) => void; className?: string }) {
  const lp = useLongPress(() => onMenu(entry));
  return (
    <div className={`m-bubble${mine ? " m-bubble--me" : " m-bubble--bot"}${className ? ` ${className}` : ""}`} {...lp}>
      {children}
    </div>
  );
}

export function ChatScreen({ chatId }: { chatId: string }) {
  const m = useM();
  const { t, lang, chats, bot, status, sync, online, outbox, loadChat, putChat, markSeen, job } = m;
  const cached = chats[chatId];
  const chat = cached?.chat;
  const version = cached?.version ?? 0;
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">(cached ? "ok" : "loading");
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [answered, setAnswered] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [menu, setMenu] = useState<Entry | null>(null);
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
  const view: Chat | undefined = chat ?? (isNewDm && dmBot ? { id: chatId, kind: "direct", name: dmBot.name, memberIds: [dmBot.id], createdAt: 0, updatedAt: 0, entries: [] } : undefined);

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

  // ---------- read marks and scrolling ----------
  const entries = view?.entries ?? [];
  const lastAt = entries[entries.length - 1]?.at ?? 0;
  useEffect(() => {
    if (chat) markSeen(chatId);
  }, [chat, chatId, markSeen, lastAt]);

  const count = entries.length + mine.length;
  const running = view ? runningEntry(view) : undefined;
  useEffect(() => {
    const near = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
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
  const blocker = chatBlocker(view, jobs, computer.state, mine.some((o) => o.state === "sent"));
  const canSend = sync === "on" && !localBot;

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

  // ---------- header ----------
  const activity = running ? liveActivity(running, lang) : null;
  const sub = activity ? activity.label : computer.state === "online" ? t("chat.computerOn") : null;
  const center = view ? (
    <span className="m-chathead">
      <span className="m-chathead__face" aria-hidden>
        <ChatFace faces={members.map((b) => b?.face ?? {})} size={30} mood={activity?.mood} />
      </span>
      <span className="m-chathead__text">
        <span className="m-chathead__name" dir="auto">
          {title}
        </span>
        {sub && <span className={`m-chathead__sub${activity ? " is-live" : ""}`}>{sub}</span>}
      </span>
    </span>
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

  const renderUser = (e: UserEntry) => (
    <div className="m-msg m-msg--me" key={e.id}>
      {stamp(e.at)}
      {e.replyTo && (
        <div className="m-reply" dir="auto">
          <b>{e.replyTo.who}</b> {e.replyTo.text.slice(0, 120)}
        </div>
      )}
      {(e.attachments ?? []).map((a) => (
        <div className="m-file" key={a.id}>
          <Icon name="file" size={18} />
          <span dir="auto">{t("chat.file", { name: a.name })}</span>
        </div>
      ))}
      {e.text.trim() && (
        <Bubble entry={e} mine onMenu={setMenu}>
          <p dir={textDir(e.text)}>{e.text}</p>
        </Bubble>
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
    const showName = view?.kind === "group" && (i === 0 || entries[i - 1]?.kind !== "bot" || (entries[i - 1] as BotEntry).botId !== e.botId);
    if (!text.trim() && !live && e.status !== "error" && e.status !== "stopped") return null;
    return (
      <div className="m-msg m-msg--bot" key={e.id}>
        {stamp(e.at)}
        {showName && <div className="m-msg__name">{name}</div>}
        <div className="m-msg__row">
          <span className="m-msg__face" aria-hidden>
            {lastOfRun ? <BotFace face={b?.face} size={30} mood={act?.mood} /> : null}
          </span>
          <div className="m-msg__col">
            {text.trim() && (
              <Bubble entry={e} mine={false} onMenu={setMenu}>
                <Markdown text={text} />
              </Bubble>
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
            {e.status === "error" && e.errorCode !== "needs_computer" && (
              <p className="m-msg__err">
                <Icon name="warn" size={15} /> {t("chat.error", { error: (e.error ?? t("chats.failed")).slice(0, 200) })}
              </p>
            )}
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
      </section>
    ) : blocker === "queued_offline" ? (
      <p className="m-queued" role="status">
        <Icon name="laptop" size={16} /> {t("chat.queued")}
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
              <p dir={textDir(o.text)}>{o.text}</p>
            </button>
            <span className={`m-out${o.state === "failed" ? " is-failed" : ""}`}>{o.state === "sending" ? t("chat.sending") : o.state === "sent" ? t("chat.sent") : t("chat.notSent")}</span>
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
      <NavBar title={title} back={{ href: "/m", label: t("tab.chats") }} center={center} solid />
      <main className="m-main m-main--chat">
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
            onSend={async (text) => {
              tap();
              const ok = await m.send(chatId, text);
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
                {
                  label: t("common.copy"),
                  onPress: () => {
                    void navigator.clipboard?.writeText(menu.text).then(() => showToast(t("common.copied")), () => {});
                  },
                },
              ]
            : []
        }
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
