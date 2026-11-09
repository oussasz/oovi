"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { PROVIDERS } from "@/lib/providers-meta";
import type { PublicSettings } from "@/lib/settings";
import type { Bot, ChatSummary } from "@/lib/types";
import Face, { FaceStack } from "./Face";
import { useI18n } from "./I18n";
import Icon from "./Icon";

export default function Home() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [chiefId, setChiefId] = useState<string | null>(null);
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
  // The Chief (main bot) comes first.
  const chief = bots.find((b) => b.id === chiefId);
  const botList = chief ? [chief, ...bots.filter((b) => b !== chief)] : bots;
  // With theOovi (signed in, no own key needed) there's nothing to set up.
  const needsKey = settings && !settings.hosted && PROVIDERS[settings.active].needsKey && !settings.providers[settings.active]?.hasKey;
  const first = groups[0];

  return (
    <div className="page home">
      <section className="hero">
        <picture>
          <source srcSet="/mark-dark.png" media="(prefers-color-scheme: dark)" />
          <img src="/mark.png" alt="" width={96} height={96} />
        </picture>
        <h1>{t("home.title")}</h1>
        <p>{t("home.sub")}</p>
        {needsKey && (
          <div className="notice">
            {rich("home.needsKey", { provider: PROVIDERS[settings.active].label, settings: <Link href="/settings">{t("common.settings")}</Link> })}
          </div>
        )}
        <div className="hero-actions">
          <Link className="btn primary" href={first ? `/c/${first.id}` : "/groups/new"}>
            {first ? t("home.open", { name: first.name }) : t("home.createGroup")} <Icon name="arrow" size={16} />
          </Link>
          <Link className="btn" href="/bots/new">
            <Icon name="plus" size={16} /> {t("common.newBot")}
          </Link>
        </div>
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
        <h2 className="section-title">{t("common.bots")}</h2>
        <div className="tiles">
          {botList.map((b) => (
            <Link key={b.id} href={`/c/dm-${b.id}`} className="tile">
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
