"use client";

import Link from "next/link";
import { dmId } from "../_lib/core";
import { Icon } from "./Icon";
import { BotFace, ChatFace, Empty, SlimeTrio, LargeTitle, NavBar, OfflineBar, Section, Spinner, TabBar, usePullToRefresh } from "./kit";
import { useM } from "./MobileApp";
import { to } from "../_lib/route";

export function BotsScreen() {
  const { t, setup, refresh, bot } = useM();
  const ptr = usePullToRefresh(() => refresh({ setup: true }));
  const bots = (setup?.bots ?? []).filter((b) => !b.hidden);
  const main = bots.find((b) => b.id === setup?.mainId);
  const others = bots.filter((b) => b !== main);
  // Groups the phone has a chat for (synced), or that the setup lists.
  const groups = (setup?.groups ?? []).filter((g) => g.memberIds.length);

  const botRow = (b: (typeof bots)[number]) => (
    <Link key={b.id} href={`${to()}/c/${encodeURIComponent(dmId(b.id))}`} className="m-row is-tap m-row--tall">
      <span className="m-row__icon" aria-hidden>
        <BotFace face={b.face} size={44} />
      </span>
      <span className="m-row__main">
        <span className="m-row__title" dir="auto">
          {b.name}
        </span>
        <span className="m-row__sub" dir="auto">
          {b.local ? t("bots.local") : b.role}
        </span>
      </span>
      <Icon name="chevron" size={18} stroke={2.4} className="m-row__chev m-flip" />
    </Link>
  );

  return (
    <div className="m-screen m-screen--tabs m-screen--grouped">
      <NavBar title={t("bots.title")} large />
      <main className="m-main">
        {ptr}
        <LargeTitle>{t("bots.title")}</LargeTitle>
        <OfflineBar />
        {!setup ? (
          <div className="m-center">
            <Spinner />
          </div>
        ) : !bots.length ? (
          <Empty art={<SlimeTrio mood="thinking" />} title={t("bots.title")} body={t("bots.empty")} />
        ) : (
          <>
            {main && <Section header={t("bots.main")}>{botRow(main)}</Section>}
            {others.length > 0 && <Section header={main ? t("bots.team") : undefined}>{others.map(botRow)}</Section>}
            {groups.length > 0 && (
              <Section header={t("bots.groups")}>
                {groups.map((g) => (
                  <Link key={g.id} href={`${to()}/c/${encodeURIComponent(g.id)}`} className="m-row is-tap m-row--tall">
                    <span className="m-row__icon" aria-hidden>
                      <ChatFace faces={g.memberIds.slice(0, 3).map((id) => bot(id)?.face ?? {})} size={44} />
                    </span>
                    <span className="m-row__main">
                      <span className="m-row__title" dir="auto">
                        {g.name}
                      </span>
                      <span className="m-row__sub" dir="auto">
                        {g.memberIds.map((id) => bot(id)?.name).filter(Boolean).join(", ")}
                      </span>
                    </span>
                    <Icon name="chevron" size={18} stroke={2.4} className="m-row__chev m-flip" />
                  </Link>
                ))}
              </Section>
            )}
          </>
        )}
      </main>
      <TabBar />
    </div>
  );
}
