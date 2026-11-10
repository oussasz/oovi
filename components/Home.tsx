"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { PROVIDERS } from "@/lib/providers-meta";
import type { PublicSettings } from "@/lib/settings";
import type { Bot, ChatSummary } from "@/lib/types";
import Face, { FaceStack } from "./Face";
import { useI18n } from "./I18n";
import Icon from "./Icon";

/** Example tasks for a first message: what people actually start with (posts, slides, budgets, daily digests). */
const IDEAS = ["home.idea.post", "home.idea.slides", "home.idea.budget", "home.idea.digest"] as const;

export default function Home() {
  const router = useRouter();
  const [bots, setBots] = useState<Bot[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [chiefId, setChiefId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const { t, rich } = useI18n();

  useEffect(() => {
    Promise.all([api<Bot[]>("/api/bots"), api<ChatSummary[]>("/api/chats"), api<PublicSettings>("/api/settings")])
      .then(([b, c, s]) => {
        setBots(b);
        setChats(c);
        setSettings(s);
      })
      .catch(() => {});
    api<{ botId: string | null }>("/api/main")
      .then((m) => setChiefId(m.botId))
      .catch(() => {});
  }, []);

  const groups = chats.filter((c) => c.kind === "group");
  const face = (id: string) => bots.find((b) => b.id === id)?.face;
  // The Chief (main bot) comes first; hidden bots work in their groups but aren't listed.
  const chief = bots.find((b) => b.id === chiefId);
  const ordered = chief ? [chief, ...bots.filter((b) => b !== chief)] : bots;
  const hidden = ordered.filter((b) => b.hidden && b !== chief);
  const botList = ordered.filter((b) => !b.hidden || b === chief || showHidden);
  // With theOovi (signed in, no own key needed) there's nothing to set up.
  const needsKey = settings && !settings.hosted && PROVIDERS[settings.active].needsKey && !settings.providers[settings.active]?.hasKey;
  const first = groups[0];

  /** The first message goes to the Chief, who answers or puts the right group to work. */
  async function send() {
    const msg = text.trim();
    if (!msg || !chief || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch(`/api/chats/dm-${chief.id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: msg }) });
      if (!r.ok && r.status !== 409) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || t("home.sendFailed"));
      router.push(`/c/dm-${chief.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-faces">{chief ? <Face face={chief.face} size={88} mood="happy" interactive /> : <img src="/mark.png" alt="" width={88} height={88} />}</div>
        <h1>{t("home.askTitle")}</h1>
        <p>{chief ? t("home.askSub", { name: chief.name }) : t("home.sub")}</p>
        {needsKey && (
          <div className="notice">
            {rich("home.needsKey", { provider: PROVIDERS[settings.active].label, settings: <Link href="/settings">{t("common.settings")}</Link> })}
          </div>
        )}
        {chief ? (
          <>
            <form
              className="composer home-ask"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                ref={box}
                dir="auto"
                rows={2}
                value={text}
                maxLength={20000}
                placeholder={t("home.askPlaceholder", { name: chief.name })}
                aria-label={t("home.askPlaceholder", { name: chief.name })}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button type="submit" className="send"disabled={!text.trim() || sending || !!needsKey} aria-label={t("chat.send")} aria-busy={sending}>
                <Icon name="send" size={18} />
              </button>
            </form>
            {error && <div className="notice error">{error}</div>}
            <div className="ideas home-ideas">
              {IDEAS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="idea"
                  onClick={() => {
                    // Fill the box so the user can adapt it (their business, their topic) before sending.
                    setText(t(k));
                    requestAnimationFrame(() => box.current?.focus());
                  }}
                >
                  {t(k)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="hero-actions">
            <Link className="btn primary" href={first ? `/c/${first.id}` : "/groups/new"}>
              {first ? t("home.open", { name: first.name }) : t("home.createGroup")} <Icon name="arrow" size={16} />
            </Link>
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">{t("common.groups")}</h2>
        <div className="tiles">
          {groups.map((g) => (
            <Link key={g.id} href={`/c/${g.id}`} className="tile">
              <FaceStack faces={g.memberIds.map(face).filter((f): f is NonNullable<typeof f> => !!f)} size={64} />
              <b>{g.name}</b>
              <span>{g.preview || g.memberIds.map((id) => bots.find((b) => b.id === id)?.name).filter(Boolean).join(", ")}</span>
            </Link>
          ))}
          <Link href="/groups/new" className="tile add">
            <span className="add-circle">
              <Icon name="plus" />
            </span>
            <b>{t("common.newGroup")}</b>
            <span>{t("home.newGroupSub")}</span>
          </Link>
        </div>
      </section>

      <section>
        <h2 className="section-title">
          {t("common.bots")}
          {hidden.length > 0 && (
            <button type="button" className="link-btn section-aside" onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? t("side.hideHidden") : t("side.showHidden", { count: hidden.length })}
            </button>
          )}
        </h2>
        <div className="tiles">
          {botList.map((b) => (
            <Link key={b.id} href={`/c/dm-${b.id}`} className={`tile${b.hidden ? " is-hidden" : ""}`}>
              <Face face={b.face} size={64} />
              <b>
                {b.name}
                {b === chief && (
                  <span className="chief-tag" title={t("chief.what")}>
                    {t("chief.title")}
                  </span>
                )}
              </b>
              <span>{b.role || t("common.bot")}</span>
              <span className="tags">
                {b.tools.web && <span className="tag">{t("home.tagWeb")}</span>}
                {b.tools.browser && <span className="tag">{t("home.tagBrowser")}</span>}
                {b.provider && <span className="tag">{PROVIDERS[b.provider].label.replace(/ \(.*\)$/, "")}</span>}
              </span>
            </Link>
          ))}
          <Link href="/bots/new" className="tile add">
            <span className="add-circle">
              <Icon name="plus" />
            </span>
            <b>{t("common.newBot")}</b>
            <span>{t("home.newBotSub")}</span>
          </Link>
        </div>
      </section>

      <section className="how">
        <h2 className="section-title">{t("home.how")}</h2>
        <ol>
          <li>{rich("home.how1", { mention: <b>{t("home.how1b")}</b> })}</li>
          <li>{rich("home.how2", { b: <b>{t("home.how2b")}</b> })}</li>
          <li>{rich("home.how3", { b: <b>{t("home.how3b")}</b> })}</li>
        </ol>
      </section>
    </div>
  );
}
