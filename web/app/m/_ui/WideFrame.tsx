"use client";

// One app that adapts: on a phone, one screen at a time (the route's page). On a wide screen (the web version at
// /app, a tablet, a computer's browser) two columns like WhatsApp Web: a rail of sections, the list of the current
// section on the left (chats, bots or settings), and on the right the open chat or connector, or a quiet welcome.
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { inApp } from "../_lib/route";
import { BotsScreen } from "./BotsScreen";
import { ChatsScreen } from "./ChatsScreen";
import { PaneCtx, SlimeTrio, TabBar, useWide } from "./kit";
import { useM } from "./MobileApp";
import { SettingsScreen } from "./SettingsScreen";

function Pane({ className, children, label }: { className: string; children: ReactNode; label: string }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <section ref={setEl} className={`m-pane ${className}`} aria-label={label}>
      <PaneCtx.Provider value={el}>{el ? children : null}</PaneCtx.Provider>
    </section>
  );
}

export function WideFrame({ children }: { children: ReactNode }) {
  const wide = useWide();
  const { t } = useM();
  const path = inApp(usePathname() ?? "");
  // Sign-in and the offline page stay one plain screen.
  if (!wide || path.startsWith("/login") || path.startsWith("/offline")) return <>{children}</>;
  const section = path.startsWith("/bots") ? "bots" : path.startsWith("/settings") || path.startsWith("/connectors") ? "settings" : "chats";
  const detail = path.startsWith("/c/") || path.startsWith("/connectors");
  const left = section === "bots" ? <BotsScreen /> : section === "settings" ? <SettingsScreen /> : <ChatsScreen archivedView={path.startsWith("/archived")} />;
  const hello = section === "bots" ? t("wide.pickBot") : section === "settings" ? t("wide.pickSetting") : t("wide.pickChat");
  return (
    <div className="m-wide">
      <TabBar rail />
      <Pane className="m-pane--list" label={section === "bots" ? t("tab.bots") : section === "settings" ? t("tab.settings") : t("tab.chats")}>
        {left}
      </Pane>
      <Pane className="m-pane--main" label={hello}>
        {detail ? (
          children
        ) : (
          <div className="m-welcome">
            <SlimeTrio mood="happy" size={150} />
            <h2>{hello}</h2>
            <p>{t("wide.sub")}</p>
          </div>
        )}
      </Pane>
    </div>
  );
}
