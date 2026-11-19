"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { agoShort, bytesLabel, computerState, syncUse } from "../_lib/core";
import { Icon } from "./Icon";
import { ActionSheet, IconTile, LargeTitle, NavBar, OfflineBar, Row, Section, Sheet, Spinner, usePullToRefresh, useWide } from "./kit";
import { DesktopSuggestion } from "./Desktop";
import { useM } from "./MobileApp";
import { base, to } from "../_lib/route";

type BeforeInstall = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function SettingsScreen() {
  const m = useM();
  const wide = useWide();
  const { t, lang, me, status, sync, credits, loadCredits, prefs, setPrefs, refresh, setup, connectors } = m;
  const [sheet, setSheet] = useState<"lang" | "look" | "signout" | null>(null);
  const [install, setInstall] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState<BeforeInstall | null>(null);
  const [leaving, setLeaving] = useState(false);
  const ptr = usePullToRefresh(async () => {
    await Promise.all([refresh({ setup: true }), loadCredits()]);
  });

  useEffect(() => {
    void loadCredits();
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const h = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstall);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, [loadCredits]);

  const now = Date.now();
  const desktops = (status?.devices ?? []).filter((d) => d.kind === "desktop");
  const comp = computerState(status);
  const nf = new Intl.NumberFormat(lang === "ar" ? "ar-DZ" : lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 1, numberingSystem: "latn" } as Intl.NumberFormatOptions);
  const langName = { auto: t("settings.auto"), en: "English", fr: "Français", ar: "العربية" }[prefs.lang];
  const lookName = { auto: t("settings.auto"), light: t("settings.light"), dark: t("settings.dark") }[prefs.theme];
  const inVault = Object.values(connectors);
  const connectorsOn = (inVault.length ? inVault : (setup?.connectors ?? [])).filter((c) => c.enabled).length;

  const signOut = async () => {
    setLeaving(true);
    try {
      await authClient.signOut();
    } catch {
      /* signed out here anyway */
    }
    m.signedOut();
  };

  return (
    <div className="m-screen m-screen--grouped">
      <NavBar title={t("settings.title")} large back={wide ? undefined : { href: to(), label: t("tab.chats") }} />
      <main className="m-main">
        {ptr}
        <LargeTitle>{t("settings.title")}</LargeTitle>
        <OfflineBar />

        <Section>
          <div className="m-row m-row--account">
            <span className="m-avatar" aria-hidden>
              {(me?.name || me?.email || "?").trim().slice(0, 1).toUpperCase()}
            </span>
            <span className="m-row__main">
              <span className="m-row__title m-row__title--big" dir="auto">
                {me?.name || t("settings.account")}
              </span>
              <span className="m-row__sub" dir="ltr">
                {me?.email ?? ""}
              </span>
            </span>
          </div>
        </Section>

        <Section header={t("settings.credits")} footer={t("settings.creditsNote")} id="credits-h">
          <Row icon={<IconTile name="sparkle" color="var(--m-blob-lilac)" />} title={t("settings.balance")} value={credits ? nf.format(credits.balance) : <Spinner size={16} />} />
          {credits && credits.dailyLimit > 0 && (
            <Row icon={<IconTile name="contrast" color="var(--m-blob-blue)" />} title={t("settings.today")} value={`${nf.format(credits.dailyUsed)} / ${nf.format(credits.dailyLimit)}`} />
          )}
          {credits?.plan?.name && <Row icon={<IconTile name="check" color="var(--m-blob-mint)" />} title={t("settings.plan")} value={credits.plan.name} />}
          {credits?.message && credits.state !== "ok" && <div className="m-row m-row--note">{credits.message}</div>}
          {credits?.links?.subscribe && <Row title={<span className="m-link">{t("settings.getMore")}</span>} href={credits.links.subscribe} external />}
        </Section>

        <Section header={t("settings.devices")} footer={comp.state === "none" ? t("settings.noComputerNote") : undefined}>
          {desktops.length ? (
            desktops.map((d) => (
              <Row
                key={d.deviceId}
                icon={<IconTile name="laptop" color="var(--m-blob-grey)" />}
                title={d.name || t("settings.computer")}
                value={
                  <span className={`m-device m-device--${d.online ? "online" : "offline"}`}>
                    <i aria-hidden />
                    {d.online ? t("settings.online") : t("settings.offlineSince", { ago: agoShort(Date.parse(d.lastSeen) || now, now, lang) })}
                  </span>
                }
              />
            ))
          ) : (
            <Row icon={<IconTile name="laptop" color="var(--m-blob-grey)" />} title={t("settings.noComputer")} />
          )}
          <Row icon={<IconTile name={base() === "/app" ? "globe" : "phone"} color="var(--m-blob-mint)" />} title={base() === "/app" ? t("settings.thisBrowser") : t("settings.thisPhone")} value={<span className="m-device m-device--online"><i aria-hidden />{t("settings.online")}</span>} />
        </Section>

        <Section header={t("settings.sync")} footer={t("settings.syncNote")}>
          <Row
            icon={<IconTile name="cloud" color="var(--m-blob-blue)" />}
            title={t("settings.syncChats")}
            value={sync === "loading" ? <Spinner size={16} /> : status?.enabled ? t("common.on") : t("common.off")}
          />
          {status?.enabled && (
            <>
              <Row title={t("settings.syncCount")} value={nf.format(status.chats)} />
              <div className="m-row m-row--meter">
                <span className="m-row__main">
                  <span className="m-row__title">{t("settings.space")}</span>
                  <span className="m-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(syncUse(status) * 100)} aria-label={t("settings.space")}>
                    <i style={{ width: `${Math.max(2, syncUse(status) * 100)}%` }} className={syncUse(status) > 0.9 ? "is-full" : ""} />
                  </span>
                </span>
                <span className="m-row__value">{t("settings.spaceOf", { used: bytesLabel(status.bytes, lang), limit: bytesLabel(status.limit, lang) })}</span>
              </div>
              <Row title={t("settings.lastSync")} value={status.lastSync ? agoShort(Date.parse(status.lastSync), now, lang) : t("settings.never")} />
            </>
          )}
          <Row icon={<IconTile name="plug" color="var(--m-blob-yellow)" />} title={t("settings.connectors")} value={setup ? String(connectorsOn) : undefined} href={to("/connectors")} />
        </Section>

        <Section header={t("settings.prefs")}>
          <Row icon={<IconTile name="globe" color="var(--m-blob-lilac)" />} title={t("settings.language")} value={langName} onClick={() => setSheet("lang")} chevron />
          <Row icon={<IconTile name="contrast" color="var(--m-blob-yellow)" />} title={t("settings.appearance")} value={lookName} onClick={() => setSheet("look")} chevron />
          {!standalone && <Row icon={<IconTile name="plusSquare" color="var(--m-blob-blue)" />} title={t("settings.install")} onClick={() => setInstall(true)} chevron />}
        </Section>

        <div className="m-section">
          <DesktopSuggestion variant="card" />
        </div>

        <Section>
          <Row title={<span className="m-row__center">{leaving ? <Spinner size={18} /> : t("settings.signOut")}</span>} danger onClick={() => setSheet("signout")} />
        </Section>

        <p className="m-footer">
          <Icon name="sparkle" size={14} /> {t("settings.footer")}
        </p>
      </main>

      <ActionSheet
        open={sheet === "lang"}
        title={t("settings.language")}
        onClose={() => setSheet(null)}
        actions={(["auto", "en", "fr", "ar"] as const).map((l) => ({
          label: { auto: t("settings.auto"), en: "English", fr: "Français", ar: "العربية" }[l],
          checked: prefs.lang === l,
          onPress: () => setPrefs({ ...prefs, lang: l }),
        }))}
      />
      <ActionSheet
        open={sheet === "look"}
        title={t("settings.appearance")}
        onClose={() => setSheet(null)}
        actions={(["auto", "light", "dark"] as const).map((l) => ({
          label: { auto: t("settings.auto"), light: t("settings.light"), dark: t("settings.dark") }[l],
          checked: prefs.theme === l,
          onPress: () => setPrefs({ ...prefs, theme: l }),
        }))}
      />
      <ActionSheet
        open={sheet === "signout"}
        message={t("settings.signOutAsk")}
        onClose={() => setSheet(null)}
        actions={[{ label: t("settings.signOut"), destructive: true, onPress: () => void signOut() }]}
      />
      <Sheet open={install} title={t("install.title")} onClose={() => setInstall(false)}>
        {prompt && !ios ? (
          <button
            type="button"
            className="m-btn m-btn--fill m-btn--wide"
            onClick={async () => {
              await prompt.prompt();
              setPrompt(null);
              setInstall(false);
            }}
          >
            {t("install.button")}
          </button>
        ) : ios ? (
          <ol className="m-steps">
            <li>
              <Icon name="share" size={22} />
              <span>{t("install.ios1")}</span>
            </li>
            <li>
              <Icon name="plusSquare" size={22} />
              <span>{t("install.ios2")}</span>
            </li>
            <li>
              <Icon name="check" size={22} />
              <span>{t("install.ios3")}</span>
            </li>
          </ol>
        ) : (
          <p className="m-sheet__text">{t("install.android")}</p>
        )}
      </Sheet>
    </div>
  );
}
