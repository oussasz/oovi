"use client";

import { Icon } from "./Icon";
import { Empty, LargeTitle, NavBar, Section, Spinner, usePullToRefresh } from "./kit";
import { useM } from "./MobileApp";

/** Read-only: the connectors set up on the computer, with their name and on/off. No address, command or key. */
export function ConnectorsScreen() {
  const { t, setup, refresh } = useM();
  const ptr = usePullToRefresh(() => refresh({ setup: true }));
  const list = setup?.connectors ?? [];
  return (
    <div className="m-screen m-screen--grouped">
      <NavBar title={t("connectors.title")} large back={{ href: "/m/settings", label: t("settings.title") }} />
      <main className="m-main">
        {ptr}
        <LargeTitle>{t("connectors.title")}</LargeTitle>
        {!setup ? (
          <div className="m-center">
            <Spinner />
          </div>
        ) : !list.length ? (
          <Empty icon={<Icon name="plug" size={44} stroke={1.6} />} title={t("connectors.empty")} body={t("connectors.note")} />
        ) : (
          <Section footer={t("connectors.note")}>
            {list.map((c) => (
              <div className="m-row" key={c.id}>
                <span className="m-row__icon" aria-hidden>
                  <span className="m-letter">{c.name.trim().slice(0, 1).toUpperCase()}</span>
                </span>
                <span className="m-row__main">
                  <span className="m-row__title" dir="auto">
                    {c.name}
                  </span>
                  <span className="m-row__sub">{c.kind === "local" ? t("connectors.local") : t("connectors.online")}</span>
                </span>
                <span className={`m-state${c.enabled ? " is-on" : ""}`}>{c.enabled ? t("common.on") : t("common.off")}</span>
              </div>
            ))}
          </Section>
        )}
      </main>
    </div>
  );
}
