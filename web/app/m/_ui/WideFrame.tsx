"use client";

// One app that adapts: on a phone, one screen at a time (the route's page). On a wide screen (the web version at
// /app, a tablet, a computer's browser) it reads like the computer app: a sidebar (logo, the person's picture,
// "+ Group" / "+ Bot", search, Pinned, Groups and Bots) and the open chat, Settings or a connector beside it, or a
// quiet welcome.
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { inApp } from "../_lib/route";
import { ChatsScreen } from "./ChatsScreen";
import { PaneCtx, SlimeTrio, useWide } from "./kit";
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
  const main = path.startsWith("/c/") || path.startsWith("/connectors") ? children : path.startsWith("/settings") ? <SettingsScreen /> : null;
  return (
    <div className="m-wide">
      <Pane className="m-pane--list" label={t("tab.chats")}>
        <ChatsScreen side archivedView={path.startsWith("/archived")} />
      </Pane>
      <Pane className="m-pane--main" label={main ? t("wide.open") : t("wide.pickChat")}>
        {main ?? (
          <div className="m-welcome">
            <SlimeTrio mood="happy" size={150} />
            <h2>{t("wide.pickChat")}</h2>
            <p>{t("wide.sub")}</p>
          </div>
        )}
      </Pane>
    </div>
  );
}
