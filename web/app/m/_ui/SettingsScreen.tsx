"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getAccount, resendVerification } from "../_lib/api";
import { agoShort, bytesLabel, computerState, syncUse } from "../_lib/core";
import type { Account } from "../_lib/types";
import { Icon } from "./Icon";
import { ActionSheet, IconTile, LargeTitle, MeAvatar, NavBar, OfflineBar, Row, Section, Sheet, Spinner, usePullToRefresh, useWide } from "./kit";
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
  // The account part (was the website's /account page): email confirmed, billing status. Paddle's way back adds
  // ?billing=none|unavailable.
  const [acct, setAcct] = useState<Account | null>(null);
  const [billingNote, setBillingNote] = useState<"none" | "unavailable" | null>(null);
  const [verify, setVerify] = useState<{ busy: boolean; text: string | null; error: boolean }>({ busy: false, text: null, error: false });
  // Subscribe / Manage: a single-use payment link for this account from POST /api/v1/billing/link, opened in the
  // phone's browser (the Android app sends _blank links to the system browser / Custom Tabs). Credits are read again
  // when the person comes back.
  const [paying, setPaying] = useState(false);
  async function pay(kind: "checkout" | "portal") {
    setPaying(true);
    setBillingNote(null);
    try {
      const r = await fetch("/api/v1/billing/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }), credentials: "same-origin" });
      const j = (await r.json().catch(() => ({}))) as { url?: string; code?: string };
      if (!r.ok || !j.url) {
        setBillingNote(j.code === "no_subscription" ? "none" : "unavailable");
        return;
      }
      if (!window.open(j.url, "_blank", "noopener")) window.location.href = j.url;
      const again = () => {
        void loadCredits?.();
        void getAccount().then(setAcct, () => {});
      };
      window.addEventListener("focus", again, { once: true });
      document.addEventListener("visibilitychange", function back() {
        if (document.visibilityState === "visible") {
          again();
          document.removeEventListener("visibilitychange", back);
        }
      });
    } catch {
      setBillingNote("unavailable");
    } finally {
      setPaying(false);
    }
  }
  const ptr = usePullToRefresh(async () => {
    await Promise.all([refresh({ setup: true }), loadCredits()]);
  });

  useEffect(() => {
    void getAccount()
      .then(setAcct)
      .catch(() => setAcct(null));
    const q = new URLSearchParams(window.location.search);
    const b = q.get("billing");
    if (b === "none" || b === "unavailable") setBillingNote(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const billStatus = (st: string | null) => {
    if (!st) return t("bill.st.none");
    const known = ["active", "trialing", "past_due", "paused", "canceled"] as const;
    const k = known.find((x) => x === st);
    return k ? t(`bill.st.${k}`) : st;
  };

  const sendVerify = async () => {
    setVerify({ busy: true, text: null, error: false });
    try {
      const r = await resendVerification();
      setVerify({ busy: false, text: t(r === "sent" ? "acct.verifySent" : "acct.verifyDone"), error: false });
    } catch (err) {
      setVerify({ busy: false, text: (err as Error).message || t("acct.error"), error: true });
    }
  };

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
          <Row
            icon={<MeAvatar size={56} />}
            title={
              <span className="m-row__title--big" dir="auto">
                {me?.name || t("settings.account")}
              </span>
            }
            sub={
              <>
                <span dir="ltr">{me?.email ?? ""}</span>
                <span className="m-row__hint">{t("acct.sub")}</span>
              </>
            }
            href={to("/settings/account")}
          />
        </Section>

        {acct?.askToVerify && (
          <div className="m-verify" role="region" aria-label={t("acct.verifyTitle")}>
            <b>{t("acct.verifyTitle")}</b>
            <p>{t("acct.verifyBody", { email: me?.email ?? "" })}</p>
            <button type="button" className="m-btn m-btn--fill m-btn--sm" onClick={() => void sendVerify()} disabled={verify.busy || (!!verify.text && !verify.error)}>
              {verify.busy ? <Spinner size={16} /> : t("acct.verifyResend")}
            </button>
            {verify.text && (
              <p className={verify.error ? "m-alert" : "m-okay"} role="status" style={{ marginTop: 10, marginBottom: 0 }}>
                {verify.text}
              </p>
            )}
          </div>
        )}

        <Section header={t("settings.credits")} footer={t("settings.creditsNote")} id="credits-h">
          <Row icon={<IconTile name="sparkle" color="var(--m-blob-lilac)" />} title={t("settings.balance")} value={credits ? nf.format(credits.balance) : <Spinner size={16} />} />
          {credits && credits.dailyLimit > 0 && (
            <Row icon={<IconTile name="contrast" color="var(--m-blob-blue)" />} title={t("settings.today")} value={`${nf.format(credits.dailyUsed)} / ${nf.format(credits.dailyLimit)}`} />
          )}
          {credits?.plan?.name && (
            <Row
              icon={<IconTile name="check" color="var(--m-blob-mint)" />}
              title={t("settings.plan")}
              sub={credits.planUntil ? t("settings.planUntil", { date: new Date(credits.planUntil).toLocaleDateString(lang === "ar" ? "ar-DZ-u-nu-latn" : lang === "fr" ? "fr-FR" : "en-US", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }) }) : undefined}
              value={credits.plan.name}
            />
          )}
          {credits?.message && credits.state !== "ok" && <div className="m-row m-row--note">{credits.message}</div>}
          {credits?.pilot?.status === "pending" && <div className="m-row m-row--note">{t("settings.pilotPending")}</div>}
          {credits?.pilot?.public && credits.pilot.eligible && credits.pilot.status === null && (
            <Row title={<span className="m-link">{t("settings.pilot")}</span>} sub={t("settings.pilotAsk", { n: nf.format(credits.pilot.credits) })} href="/pilot" external />
          )}
          {credits?.links?.subscribe && !acct?.billing && <Row title={<span className="m-link">{t("settings.getMore")}</span>} onClick={paying ? undefined : () => void pay("checkout")} />}
          <Row title={<span className="m-link">{t("settings.feedback")}</span>} href="/feedback" external />
        </Section>

        <Section
          header={t("bill.title")}
          footer={
            <>
              {t("bill.note")}{" "}
              <a href="/refund" target="_blank" rel="noopener noreferrer" className="m-link">
                {t("bill.refund")}
              </a>
            </>
          }
          id="billing-h"
        >
          {billingNote && <div className="m-row m-row--note" role="status">{t(billingNote === "none" ? "bill.none" : "bill.unavailable")}</div>}
          {acct === null ? (
            <Row title={t("bill.status")} value={<Spinner size={16} />} />
          ) : acct.billing ? (
            <>
              <Row title={t("bill.status")} value={billStatus(acct.billing.status)} />
              <Row
                icon={<IconTile name="sparkle" color="var(--m-blob-yellow)" />}
                title={t("bill.manage")}
                sub={t("bill.manageSub")}
                onClick={paying ? undefined : () => void pay("portal")}
              />
            </>
          ) : (
            <>
              <div className="m-row m-row--note">{t("bill.free")}</div>
              <Row title={<span className="m-link">{t("bill.plans")}</span>} onClick={paying ? undefined : () => void pay("checkout")} />
            </>
          )}
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
