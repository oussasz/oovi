"use client";

// Under Zapier, Pipedream and Make in the Marketplace: connecting the service is only the first step, so this says
// what comes next and gives the link or the buttons to add each app (lib/app-hubs-core.ts).
import { HUBS } from "@/lib/app-hubs-core";
import { useI18n } from "./I18n";
import ZapierApps from "./ZapierApps";

export default function AppHub({ hub, serverId, onConnect, busy }: { hub: keyof typeof HUBS; serverId?: string; onConnect?: () => void; busy?: boolean }) {
  const { t } = useI18n();
  const h = HUBS[hub];
  return (
    <section className="mk-hub" aria-label={t("hub.title")}>
      <h4>{t("hub.title")}</h4>
      {h.inApp && serverId ? (
        <>
          <p className="note">{t("hub.zapierReady")}</p>
          <ZapierApps serverId={serverId} />
        </>
      ) : (
        <>
          <ol className="mk-hub-steps">
            <li>{t("hub.step1", { name: h.name })}</li>
            <li>{h.inApp ? t("hub.step2Zapier") : t("hub.step2Other", { name: h.name })}</li>
          </ol>
          <div className="row-btns">
            {!serverId && onConnect && (
              <button className="btn primary" onClick={onConnect} disabled={busy}>
                {t("mk.connectWith", { name: h.name })}
              </button>
            )}
            {!h.inApp && (
              <a className="btn" href={h.appsUrl} target="_blank" rel="noopener noreferrer">
                {t("hub.openApps", { name: h.name })}
              </a>
            )}
          </div>
        </>
      )}
    </section>
  );
}
