"use client";

// Add a connector from the catalog: search, pick one, type its key when it needs one (a connector's key, never an
// AI model's), choose the bots that use it, Add. It is saved to the account's vault (the computer adds it too); one
// that signs in with the service (OAuth) opens its sign-in page right away.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError, putVault } from "../_lib/api";
import { addableHere, newConnectorId, vaultFromCatalog, viewOfVault, type CatalogConnector } from "../_lib/connectors";
import { matchesQuery } from "../_lib/core";
import { tap } from "../_lib/haptics";
import { Icon } from "./Icon";
import { BotFace, ConnectorLogo, Empty, LargeTitle, NavBar, Section, Sheet, Spinner } from "./kit";
import { useM } from "./MobileApp";
import { beginSignIn } from "./signin";
import { useCatalog } from "./useCatalog";

export function AddConnectorScreen() {
  const m = useM();
  const { t, connectors, setup, putConnector, toast } = m;
  const router = useRouter();
  const { list, failed } = useCatalog();
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<CatalogConnector | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [bots, setBots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const added = useMemo(() => new Set(Object.values(connectors).map((c) => c.catalogId ?? c.id)), [connectors]);
  const shown = useMemo(() => (list ?? []).filter((c) => !q.trim() || matchesQuery(q, [c.name, c.by, c.description])), [list, q]);
  const allBots = (setup?.bots ?? []).filter((b) => !b.hidden);

  const open = (c: CatalogConnector) => {
    tap();
    setPick(c);
    setValues({});
    setProblem(null);
    setBots(allBots.map((b) => b.id));
  };

  const add = async () => {
    if (!pick) return;
    const item = vaultFromCatalog(pick, values, bots, Date.now());
    if (typeof item === "string") {
      const key = item.split(":")[1];
      const label = pick.fields?.find((f) => f.key === key)?.label ?? "";
      setProblem(item.startsWith("aikey") ? t("conn.err.aikey") : item === "computer" ? t("conn.addComputer") : t("conn.err.field", { label }));
      return;
    }
    setBusy(true);
    setProblem(null);
    const existing = [...Object.keys(connectors), ...(setup?.connectors ?? []).map((c) => c.id)];
    const id = newConnectorId(pick.name, existing);
    try {
      const r = await putVault(id, 0, item);
      putConnector(id, viewOfVault(id, item), r.version);
      tap("success");
      if (item.auth === "oauth") {
        toast(t("conn.opening"));
        const p = await beginSignIn(id);
        if (p) {
          toast(t(p));
          router.replace(`/m/connectors/${encodeURIComponent(id)}`);
        }
        return;
      }
      toast(t("conn.added", { name: pick.name }));
      router.replace(`/m/connectors/${encodeURIComponent(id)}`);
    } catch (err) {
      setProblem(err instanceof ApiError && err.code === "sync_off" ? t("conn.err.sync_off") : err instanceof ApiError && err.status === 400 ? t("conn.err.aikey") : t("conn.err.save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m-screen m-screen--grouped">
      <NavBar title={t("conn.addTitle")} large back={{ href: "/m/connectors", label: t("connectors.title") }} />
      <main className="m-main">
        <LargeTitle>{t("conn.addTitle")}</LargeTitle>
        <div className="m-search">
          <Icon name="search" size={18} stroke={2.1} />
          <input type="search" enterKeyHint="search" placeholder={t("conn.search")} aria-label={t("conn.search")} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
        </div>
        {failed && <p className="m-offline">{t("conn.catalogError")}</p>}
        {!list ? (
          <div className="m-center">
            <Spinner />
          </div>
        ) : !shown.length ? (
          <p className="m-noresult">{t("chats.noResults", { q: q.trim() })}</p>
        ) : (
          <Section>
            {shown.map((c) => {
              const can = addableHere(c);
              const has = added.has(c.id);
              return (
                <button key={c.id} type="button" className="m-row is-tap m-row--tall" onClick={() => open(c)}>
                  <span className="m-row__icon" aria-hidden>
                    <ConnectorLogo name={c.name} logo={c.logo} size={36} />
                  </span>
                  <span className="m-row__main">
                    <span className="m-row__title">{c.name}</span>
                    <span className="m-row__sub">{has ? `✓ ${t("conn.alreadyAdded")}` : can === "soon" ? t("conn.soon") : can === "computer" ? t("connectors.local") : c.by}</span>
                  </span>
                  <Icon name="plus" size={20} stroke={2.2} className="m-row__chev" />
                </button>
              );
            })}
          </Section>
        )}
      </main>

      <Sheet open={!!pick} title={pick?.name ?? ""} onClose={() => setPick(null)}>
        {pick && (
          <div className="m-addc">
            <div className="m-addc__head">
              <ConnectorLogo name={pick.name} logo={pick.logo} size={52} />
              <p>{pick.description}</p>
            </div>
            {addableHere(pick) !== "yes" ? (
              <p className="m-sheet__text">{addableHere(pick) === "soon" ? (typeof pick.soon === "string" ? pick.soon : t("conn.soon")) : t("conn.addComputer")}</p>
            ) : (
              <>
                {!!pick.fields?.length && (
                  <Section header={t("conn.keys")} footer={t("conn.keyNote")}>
                    {pick.fields.map((f) => (
                      <label className="m-field m-field--key" key={f.key}>
                        <span>{f.label}</span>
                        <input
                          type={f.secret ? "password" : "text"}
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          dir="ltr"
                          placeholder={f.placeholder ?? (f.optional ? "" : "")}
                          value={values[f.key] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        />
                      </label>
                    ))}
                  </Section>
                )}
                {allBots.length > 0 && (
                  <Section header={t("conn.usedBy")}>
                    {allBots.map((b) => {
                      const on = bots.includes(b.id);
                      return (
                        <button key={b.id} type="button" className="m-row is-tap" role="checkbox" aria-checked={on} onClick={() => setBots((cur) => (on ? cur.filter((x) => x !== b.id) : [...cur, b.id]))}>
                          <span className="m-row__icon" aria-hidden>
                            <BotFace face={b.face} size={30} />
                          </span>
                          <span className="m-row__main">
                            <span className="m-row__title" dir="auto">
                              {b.name}
                            </span>
                          </span>
                          {on && <Icon name="check" size={20} stroke={2.4} className="m-check" />}
                        </button>
                      );
                    })}
                  </Section>
                )}
                {problem && (
                  <p className="m-alert" role="alert">
                    {problem}
                  </p>
                )}
                <button type="button" className="m-btn m-btn--fill m-btn--wide m-btn--lg" onClick={() => void add()} disabled={busy}>
                  {busy ? <Spinner size={18} /> : t("conn.addIt", { name: pick.name })}
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>
      {!list && failed && <Empty title={t("conn.catalogError")} />}
    </div>
  );
}
