"use client";

// The account's connectors, managed from the phone like on the computer: on/off right in the list, a row opens its
// settings (bots, sign-in, remove), "+" adds one from the catalog. Coming back from a sign-in lands here
// (/m/connectors?connected=<id> or ?error=<code>): said in plain words, then the address is cleaned.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError, changeVault } from "../_lib/api";
import { connectorViews, needsAction, signInReturn, viewOfVault, withSettings, type ConnectorView } from "../_lib/connectors";
import { Icon } from "./Icon";
import { ConnectorLogo, Empty, LargeTitle, NavBar, Section, Spinner, Switch, usePullToRefresh } from "./kit";
import { useM } from "./MobileApp";
import { useCatalog } from "./useCatalog";
import { to } from "../_lib/route";

export function statusLine(c: ConnectorView, t: ReturnType<typeof useM>["t"]): string {
  if (!c.inCloud) return t("conn.onlyComputer");
  if (!c.enabled) return t("conn.offState");
  if (c.oauth && !c.signedIn) return t("conn.signInNeeded");
  if (c.missingKeys > 0) return t("conn.keyNeeded");
  if (c.kind === "local") return t("connectors.local");
  return c.oauth ? t("conn.signedIn") : t("connectors.online");
}

export function ConnectorsScreen() {
  const m = useM();
  const { t, setup, refresh, connectors, sync, refreshConnectors, putConnector, toast } = m;
  const router = useRouter();
  const { list: catalog } = useCatalog();
  const [busy, setBusy] = useState<string | null>(null);
  const ptr = usePullToRefresh(async () => {
    await refresh({ setup: true });
    await refreshConnectors().catch(() => {});
  });

  // Back from a sign-in (the website's callback sends the browser here).
  useEffect(() => {
    const back = signInReturn(window.location.search);
    if (!back) return;
    void refreshConnectors().catch(() => {});
    const name = (id?: string) => (id && (connectors[id]?.name ?? setup?.connectors.find((c) => c.id === id)?.name)) || "";
    if (back.kind === "connected") toast(t("conn.connected", { name: name(back.id) || "✓" }).replace(/^ /, ""));
    else toast(t(`conn.err.${back.code}`));
    router.replace(to("/connectors"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sync === "on") void refreshConnectors().catch(() => {});
  }, [sync, refreshConnectors]);

  const list = useMemo(() => connectorViews(setup, connectors), [setup, connectors]);
  const logoOf = (c: ConnectorView) => catalog?.find((x) => x.id === (c.catalogId ?? c.id))?.logo;

  const toggle = async (c: ConnectorView, on: boolean) => {
    setBusy(c.id);
    putConnector(c.id, { ...c, enabled: on });
    try {
      const r = await changeVault(c.id, (d) => withSettings(d, { enabled: on }));
      putConnector(c.id, viewOfVault(c.id, r.data), r.version);
    } catch (err) {
      putConnector(c.id, c);
      toast(err instanceof ApiError && err.code === "sync_off" ? t("conn.err.sync_off") : t("conn.err.save"));
    } finally {
      setBusy(null);
    }
  };

  const canAdd = sync === "on";
  return (
    <div className="m-screen m-screen--grouped">
      <NavBar
        title={t("connectors.title")}
        large
        back={{ href: to("/settings"), label: t("settings.title") }}
        right={
          canAdd ? (
            <Link href={to("/connectors/add")} className="m-nav__btn" aria-label={t("conn.addTitle")}>
              <Icon name="plus" size={26} stroke={2.2} />
            </Link>
          ) : null
        }
      />
      <main className="m-main">
        {ptr}
        <LargeTitle>{t("connectors.title")}</LargeTitle>
        {!setup && !Object.keys(connectors).length ? (
          <div className="m-center">
            <Spinner />
          </div>
        ) : !list.length ? (
          <Empty icon={<Icon name="plug" size={44} stroke={1.6} />} title={t("connectors.empty")} body={t("conn.empty")}>
            {canAdd && (
              <Link href={to("/connectors/add")} className="m-btn m-btn--tinted">
                {t("conn.addTitle")}
              </Link>
            )}
          </Empty>
        ) : (
          <Section footer={canAdd ? t("conn.note") : t("connectors.note")}>
            {list.map((c) => {
              const warn = needsAction(c);
              const row = (
                <>
                  <span className="m-row__icon" aria-hidden>
                    <ConnectorLogo name={c.name} logo={logoOf(c)} />
                  </span>
                  <span className="m-row__main">
                    <span className="m-row__title" dir="auto">
                      {c.name}
                    </span>
                    <span className={`m-row__sub${warn ? " is-warn" : ""}`}>{statusLine(c, t)}</span>
                  </span>
                </>
              );
              return c.inCloud ? (
                <div className="m-row m-row--conn" key={c.id}>
                  <Link href={`${to()}/connectors/${encodeURIComponent(c.id)}`} className="m-row__link">
                    {row}
                    <Icon name="chevron" size={18} stroke={2.4} className="m-row__chev m-flip" />
                  </Link>
                  {busy === c.id ? <Spinner size={18} /> : <Switch on={c.enabled} onChange={(v) => void toggle(c, v)} label={`${c.name}: ${t("conn.enabled")}`} />}
                </div>
              ) : (
                <div className="m-row" key={c.id}>
                  {row}
                  <span className={`m-state${c.enabled ? " is-on" : ""}`}>{c.enabled ? t("common.on") : t("common.off")}</span>
                </div>
              );
            })}
          </Section>
        )}
      </main>
    </div>
  );
}
