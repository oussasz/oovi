"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { PROVIDERS } from "@/lib/providers-meta";
import type { PublicSettings } from "@/lib/settings";
import type { Bot, ChatSummary } from "@/lib/types";
import Face, { FaceStack } from "./Face";
import Icon from "./Icon";

export default function Home() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    Promise.all([api<Bot[]>("/api/bots"), api<ChatSummary[]>("/api/chats"), api<PublicSettings>("/api/settings")])
      .then(([b, c, s]) => {
        setBots(b);
        setChats(c);
        setSettings(s);
      })
      .catch(() => {});
  }, []);

  const groups = chats.filter((c) => c.kind === "group");
  const face = (id: string) => bots.find((b) => b.id === id)?.face;
  const needsKey = settings && PROVIDERS[settings.active].needsKey && !settings.providers[settings.active]?.hasKey;
  const first = groups[0];

  return (
    <div className="page home">
      <section className="hero">
        <picture>
          <source srcSet="/mark-dark.png" media="(prefers-color-scheme: dark)" />
          <img src="/mark.png" alt="" width={96} height={96} />
        </picture>
        <h1>Your crew is ready.</h1>
        <p>Give bots a face and a job, put them in groups, and let them pass work to each other. Everything runs on your own API key, with no subscription.</p>
        {needsKey && (
          <div className="notice">
            First, add your {PROVIDERS[settings.active].label} API key in <Link href="/settings">Settings</Link>, or pick another provider there.
          </div>
        )}
        <div className="hero-actions">
          <Link className="btn primary" href={first ? `/c/${first.id}` : "/groups/new"}>
            {first ? `Open ${first.name}` : "Create a group"} <Icon name="arrow" size={16} />
          </Link>
          <Link className="btn" href="/bots/new">
            <Icon name="plus" size={16} /> New bot
          </Link>
        </div>
      </section>

      <section>
        <h2 className="section-title">Groups</h2>
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
            <b>New group</b>
            <span>Put bots together</span>
          </Link>
        </div>
      </section>

      <section>
        <h2 className="section-title">Bots</h2>
        <div className="tiles">
          {bots.map((b) => (
            <Link key={b.id} href={`/c/dm-${b.id}`} className="tile">
              <Face face={b.face} size={64} />
              <b>{b.name}</b>
              <span>{b.role || "Bot"}</span>
              <span className="tags">
                {b.tools.web && <span className="tag">web</span>}
                {b.tools.browser && <span className="tag">browser</span>}
                {b.provider && <span className="tag">{PROVIDERS[b.provider].label.replace(/ \(.*\)$/, "")}</span>}
              </span>
            </Link>
          ))}
          <Link href="/bots/new" className="tile add">
            <span className="add-circle">
              <Icon name="plus" />
            </span>
            <b>New bot</b>
            <span>Pick a face and a job</span>
          </Link>
        </div>
      </section>

      <section className="how">
        <h2 className="section-title">How it works</h2>
        <ol>
          <li>
            <b>@mention</b> a bot to choose who answers. Nobody mentioned? The group&apos;s lead picks it up.
          </li>
          <li>
            Bots <b>@mention each other</b> to hand off work, and you watch it happen.
          </li>
          <li>
            You stay in charge: bots <b>ask before</b> they click or type on a web page.
          </li>
        </ol>
      </section>
    </div>
  );
}
