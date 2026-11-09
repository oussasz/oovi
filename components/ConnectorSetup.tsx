"use client";

// The setup card under a connector in Marketplace > Connectors > Yours:
// 1. signed in, 2. choose what oovi may do in the service, 3. test (the tools found right now),
// 4. which bots can use it. Works for any connector; Zapier gets its own instructions.
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useI18n } from "./I18n";
import Icon from "./Icon";

export type SetupServer = {
  id: string;
  name: string;
  auth?: "oauth";
  signedIn?: boolean;
  enabled: boolean;
  status: "connected" | "error" | "idle";
  error?: string;
  tools: { name: string; description?: string }[];
  bots?: string[];
};

type BotLite = { id: string; name: string };
type Test = { ok: boolean; tools?: string[]; details?: { name: string; description?: string }[]; error?: string };

export default function ConnectorSetup(props: { server: SetupServer; catalogId?: string; setupUrl?: string; busy: boolean; onSignIn: () => void; onChanged: () => void }) {
  const { server: s, catalogId, setupUrl, busy, onSignIn, onChanged } = props;
  const { t } = useI18n();
  const [bots, setBots] = useState<BotLite[]>([]);
  const [mainId, setMainId] = useState<string | null>(null);
  const [on, setOn] = useState<string[]>(s.bots ?? []);
  const [test, setTest] = useState<Test | null>(null);
  const [testing, setTesting] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const zapier = catalogId === "zapier";
  const signedIn = s.auth !== "oauth" || !!s.signedIn;

  useEffect(() => {
    api<BotLite[]>("/api/bots").then((b) => setBots(b.map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
    api<{ botId: string | null }>("/api/main").then((m) => setMainId(m.botId)).catch(() => {});
  }, []);
  useEffect(() => setOn(s.bots ?? []), [s.bots]);

  async function runTest() {
    setTesting(true);
    try {
      setTest(await api<Test>(`/api/mcp/${s.id}`, { method: "POST" }));
    } catch (e) {
      setTest({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
      onChanged();
    }
  }

  async function saveBots(next: string[]) {
    const before = on;
    setOn(next);
    setSaveErr(null);
    try {
      const r = await api<{ bots: string[] }>(`/api/mcp/${s.id}`, { method: "PUT", body: JSON.stringify({ bots: next }) });
      setOn(r.bots);
      onChanged();
    } catch (e) {
      setOn(before);
      setSaveErr((e as Error).message);
    }
  }

  const toggle = (id: string) => void saveBots(on.includes(id) ? on.filter((x) => x !== id) : [...on, id]);
  const allOn = bots.length > 0 && bots.every((b) => on.includes(b.id));
  const found = test?.ok ? (test.details ?? (test.tools ?? []).map((name) => ({ name, description: undefined }))) : null;
  const shownTools = found ?? (s.tools.length ? s.tools : null);

  return (
    <div className="cs-card" aria-label={t("conn.setupTitle", { name: s.name })}>
      <ol className="cs-steps">
        <li className={signedIn ? "done" : ""}>
          <span className="cs-num">{signedIn ? <Icon name="check" size={14} /> : 1}</span>
          <div>
            <b>{s.auth === "oauth" ? (signedIn ? t("conn.signedIn", { name: s.name }) : t("conn.signIn", { name: s.name })) : t("conn.added", { name: s.name })}</b>
            {!signedIn && (
              <div className="cs-act">
                <button className="btn sm primary" disabled={busy} onClick={onSignIn}>
                  {t("mk.connect")}
                </button>
              </div>
            )}
          </div>
        </li>

        {setupUrl && (
          <li>
            <span className="cs-num">2</span>
            <div>
              <b>{t("conn.choose", { name: s.name })}</b>
              <p className="note">{zapier ? t("conn.zapier.choose") : t("conn.chooseHint", { name: s.name })}</p>
              {zapier && <p className="note cs-example">{t("conn.zapier.example")}</p>}
              <div className="cs-act">
                <a className="btn sm" href={setupUrl} target="_blank" rel="noopener noreferrer">
                  {t("conn.open", { name: zapier ? "Zapier MCP" : s.name })} <Icon name="arrow" size={14} />
                </a>
              </div>
            </div>
          </li>
        )}

        <li>
          <span className="cs-num">{setupUrl ? 3 : 2}</span>
          <div>
            <b>{t("conn.test")}</b>
            <div className="cs-act">
              <button className="btn sm" disabled={testing || !signedIn} onClick={() => void runTest()}>
                {testing ? t("common.testing") : t("conn.testNow")}
              </button>
            </div>
            {test && !test.ok && (
              <div className="notice error small cs-msg">
                {test.error}
                {s.auth === "oauth" && <span className="cs-fix"> {t("conn.errorFix")}</span>}
              </div>
            )}
            {shownTools && shownTools.length > 0 && (
              <div className="cs-tools">
                <small>{found ? t("conn.foundNow", { count: shownTools.length }) : t("conn.foundLast", { count: shownTools.length })}</small>
                <ul>
                  {shownTools.slice(0, 24).map((x) => (
                    <li key={x.name} title={x.description}>
                      {x.name}
                    </li>
                  ))}
                  {shownTools.length > 24 && <li className="more">{t("conn.more", { count: shownTools.length - 24 })}</li>}
                </ul>
              </div>
            )}
            {found && found.length === 0 && <div className="notice small cs-msg">{zapier ? t("conn.zapier.noTools") : t("conn.noTools", { name: s.name })}</div>}
          </div>
        </li>

        <li className={on.length ? "done" : ""}>
          <span className="cs-num">{setupUrl ? 4 : 3}</span>
          <div>
            <b>{t("conn.whichBots")}</b>
            <p className="note">{t("conn.whichBotsHint")}</p>
            <div className="chip-row cs-bots">
              {bots.map((b) => {
                const has = on.includes(b.id);
                return (
                  <button key={b.id} type="button" className={`chip${has ? " on" : ""}`} aria-pressed={has} onClick={() => toggle(b.id)} disabled={!s.enabled}>
                    {has && <Icon name="check" size={13} />} {b.name}
                    {b.id === mainId && <span className="cs-main">{t("conn.main")}</span>}
                  </button>
                );
              })}
              {bots.length > 1 && !allOn && (
                <button type="button" className="btn sm" onClick={() => void saveBots(bots.map((b) => b.id))} disabled={!s.enabled}>
                  {t("conn.allBots")}
                </button>
              )}
            </div>
            {!s.enabled && <p className="note">{t("bot.serverOff")}</p>}
            {saveErr && <div className="notice error small cs-msg">{saveErr}</div>}
          </div>
        </li>
      </ol>
    </div>
  );
}
