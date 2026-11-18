"use client";

// One connector: on/off, which bots use it, its sign-in (sign in, sign in again, sign out), its keys (counted, never
// shown; a new one can be typed), and remove. Every change reads the current entry, changes it and saves it back
// (changeVault), so keys and sign-ins set elsewhere are never lost.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, changeVault, deleteVault } from "../_lib/api";
import { looksLikeAiKey, signedOut, viewOfVault, withSettings, type VaultItem } from "../_lib/connectors";
import { tap } from "../_lib/haptics";
import { statusLine } from "./ConnectorsScreen";
import { Icon } from "./Icon";
import { ActionSheet, BotFace, ConnectorLogo, Empty, NavBar, Row, Section, Spinner, Switch } from "./kit";
import { useM } from "./MobileApp";
import { beginSignIn } from "./signin";
import { useCatalog } from "./useCatalog";

export function ConnectorScreen({ id }: { id: string }) {
  const m = useM();
  const { t, connectors, setup, putConnector, toast } = m;
  const router = useRouter();
  const { list: catalog } = useCatalog();
  const c = connectors[id];
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<"signout" | "remove" | null>(null);
  const [key, setKey] = useState("");
  const cat = catalog?.find((x) => x.id === (c?.catalogId ?? id));
  const keyField = cat?.fields?.find((f) => f.secret);

  const save = async (what: string, change: (d: VaultItem) => VaultItem, done?: string) => {
    if (!c) return false;
    setBusy(what);
    try {
      const r = await changeVault(id, change);
      putConnector(id, viewOfVault(id, r.data), r.version);
      tap("success");
      if (done) toast(done);
      return true;
    } catch (err) {
      toast(err instanceof ApiError && err.code === "sync_off" ? t("conn.err.sync_off") : err instanceof ApiError && err.status === 400 ? t("conn.err.aikey") : t("conn.err.save"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!c) {
    return (
      <div className="m-screen m-screen--grouped">
        <NavBar title={t("connectors.title")} back={{ href: "/m/connectors", label: t("connectors.title") }} solid />
        <main className="m-main">
          <Empty icon={<Icon name="plug" size={44} stroke={1.6} />} title={t("connectors.empty")} body={t("connectors.note")} />
        </main>
      </div>
    );
  }

  const bots = (setup?.bots ?? []).filter((b) => !b.hidden);
  const toggleBot = (botId: string) => {
    const next = c.bots.includes(botId) ? c.bots.filter((b) => b !== botId) : [...c.bots, botId];
    putConnector(id, { ...c, bots: next });
    void save(`bot:${botId}`, (d) => withSettings(d, { bots: next })).then((ok) => !ok && putConnector(id, c));
  };

  const signIn = async () => {
    setBusy("signin");
    toast(t("conn.opening"));
    const problem = await beginSignIn(id);
    if (problem) {
      setBusy(null);
      toast(t(problem));
    }
  };

  const saveKey = async () => {
    const v = key.trim();
    if (!v || !keyField) return;
    if (looksLikeAiKey(v)) {
      toast(t("conn.err.aikey"));
      return;
    }
    const filled = keyField.template ? keyField.template.replace("{value}", v) : v;
    const ok = await save(
      "key",
      (d) =>
        keyField.to === "header" && keyField.name
          ? { ...d, headers: { ...(d.headers ?? {}), [keyField.name]: filled } }
          : { ...d, env: { ...(d.env ?? {}), [keyField.name || keyField.key]: filled } },
      t("conn.saved"),
    );
    if (ok) setKey("");
  };

  const remove = async () => {
    setBusy("remove");
    try {
      await deleteVault(id);
      putConnector(id, null);
      tap("success");
      toast(t("conn.removed", { name: c.name }));
      router.replace("/m/connectors");
    } catch {
      toast(t("conn.err.save"));
      setBusy(null);
    }
  };

  return (
    <div className="m-screen m-screen--grouped">
      <NavBar title={c.name} back={{ href: "/m/connectors", label: t("connectors.title") }} solid />
      <main className="m-main">
        <div className="m-conn-head">
          <ConnectorLogo name={c.name} logo={cat?.logo} size={64} />
          <h1 dir="auto">{c.name}</h1>
          <p className={c.oauth && !c.signedIn ? "is-warn" : ""}>{statusLine(c, t)}</p>
        </div>

        <Section>
          <div className="m-row">
            <span className="m-row__main">
              <span className="m-row__title">{t("conn.enabled")}</span>
            </span>
            {busy === "enabled" ? (
              <Spinner size={18} />
            ) : (
              <Switch
                on={c.enabled}
                label={`${c.name}: ${t("conn.enabled")}`}
                onChange={(v) => {
                  putConnector(id, { ...c, enabled: v });
                  void save("enabled", (d) => withSettings(d, { enabled: v })).then((ok) => !ok && putConnector(id, c));
                }}
              />
            )}
          </div>
        </Section>

        {c.oauth && (
          <Section header={t("conn.signInTitle")} footer={t("conn.signInNote", { name: c.name })}>
            <Row
              icon={<span className={`m-dotbig${c.signedIn ? " is-on" : ""}`} aria-hidden />}
              title={c.signedIn ? t("conn.signedIn") : t("conn.signInNeeded")}
              value={busy === "signin" ? <Spinner size={16} /> : undefined}
            />
            <Row title={<span className="m-link">{c.signedIn ? t("conn.signInAgain") : t("conn.signIn")}</span>} onClick={() => void signIn()} />
            {c.signedIn && <Row title={t("conn.signOut")} danger onClick={() => setAsk("signout")} />}
          </Section>
        )}

        {keyField && (
          <Section header={t("conn.keys")} footer={t("conn.keyNote")}>
            <label className="m-field m-field--key">
              <span>{keyField.label}</span>
              <input
                type="password"
                autoComplete="off"
                dir="ltr"
                value={key}
                placeholder={c.keys > 0 ? `•••••• ${t("conn.keySaved")}` : keyField.placeholder}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            {key.trim() && <Row title={<span className="m-link">{busy === "key" ? <Spinner size={16} /> : t("conn.saveKey")}</span>} onClick={() => void saveKey()} />}
          </Section>
        )}

        <Section header={t("conn.usedBy")} footer={c.bots.length ? t("conn.usedByNote", { name: c.name }) : t("conn.noBots")}>
          {bots.map((b) => {
            const on = c.bots.includes(b.id);
            return (
              <button key={b.id} type="button" className="m-row is-tap" role="checkbox" aria-checked={on} onClick={() => toggleBot(b.id)}>
                <span className="m-row__icon" aria-hidden>
                  <BotFace face={b.face} size={32} />
                </span>
                <span className="m-row__main">
                  <span className="m-row__title" dir="auto">
                    {b.name}
                  </span>
                </span>
                {busy === `bot:${b.id}` ? <Spinner size={16} /> : on ? <Icon name="check" size={20} stroke={2.4} className="m-check" /> : null}
              </button>
            );
          })}
        </Section>

        <Section>
          <Row title={<span className="m-row__center">{busy === "remove" ? <Spinner size={18} /> : t("conn.remove")}</span>} danger onClick={() => setAsk("remove")} />
        </Section>
      </main>
      <ActionSheet
        open={ask === "signout"}
        message={t("conn.signOutAsk", { name: c.name })}
        onClose={() => setAsk(null)}
        actions={[{ label: t("conn.signOut"), destructive: true, onPress: () => void save("signout", signedOut) }]}
      />
      <ActionSheet open={ask === "remove"} message={t("conn.removeAsk", { name: c.name })} onClose={() => setAsk(null)} actions={[{ label: t("conn.remove"), destructive: true, onPress: () => void remove() }]} />
    </div>
  );
}
