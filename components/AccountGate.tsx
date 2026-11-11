"use client";

// Everything in oovi belongs to an account. This gate shows, in order:
//   splash → sign in / create account → onboarding (first time) → the app.
// It also reports unexpected UI errors (crash reports) and hosts the Settings window.

import { isRealCrash } from "@/lib/crash-filter";
import { useCallback, useEffect, useState } from "react";
import { api, resizeImage } from "@/lib/client";
import { randomFace, type Face as FaceT } from "@/lib/faces";
import { LOCALES, NATIVE_NAMES } from "@/lib/i18n";
import { HOSTED_NAME, PROVIDER_IDS, PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import type { Bot, ChatSummary } from "@/lib/types";
import Face from "./Face";
import { announceLanguage, useI18n } from "./I18n";
import Icon from "./Icon";
import Logo from "./Logo";
import SettingsModal, { openSettings } from "./SettingsModal";

/** Set once someone has signed in on this computer: then the sign-in screen opens on "Sign in", not "Create account". */
const SIGNED_IN_BEFORE = "oovi.signedInBefore";

/** The language picked on the sign-in screen, saved to the account once it exists. */
let pickedLanguage: string | null = null;

/** Language picker for screens before the app (sign in, onboarding). "auto" follows the computer's language. */
function LanguagePick() {
  const { t, locale } = useI18n();
  const [value, setValue] = useState<string>("auto");
  return (
    <label className="gate-lang">
      <Icon name="lang" size={16} />
      <select
        value={value === "auto" ? "auto" : locale}
        onChange={(e) => {
          setValue(e.target.value);
          pickedLanguage = e.target.value;
          announceLanguage(e.target.value);
        }}
        aria-label={t("gate.language")}
      >
        <option value="auto">{t("gate.languageAuto")}</option>
        {LOCALES.map((l) => (
          <option key={l} value={l}>{NATIVE_NAMES[l]}</option>
        ))}
      </select>
    </label>
  );
}

/** Keep the language chosen before signing in (the account's own setting would otherwise replace it). */
async function savePickedLanguage() {
  if (!pickedLanguage) return;
  await api("/api/settings", { method: "POST", body: JSON.stringify({ language: pickedLanguage }) }).catch(() => {});
  announceLanguage(pickedLanguage);
}

export type AccountState = {
  loggedIn: boolean;
  onboarded: boolean;
  cloudUrl: string;
  user: { id: string; email: string; name: string; image: string | null } | null;
};

/** Shown in place of the user's photo until they pick one (a bot face, not the logo). */
const PHOTO_PLACEHOLDER: FaceT = { color: 1, shape: 2, hair: 0, eyes: 1, nose: 0, mouth: 0, cheeks: 1, top: 0, wear: 0 };

function reportCrash(message: string, stack?: string) {
  if (!isRealCrash(message)) return; // a browser notice, not a crash (lib/crash-filter.ts)
  void fetch("/api/crash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, stack, context: location.pathname }) }).catch(() => {});
}

// ---------- sign in / create account ----------

function AuthScreen({ cloudUrl, onDone }: { cloudUrl: string; onDone: (s: AccountState) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [, setTouched] = useState(false);
  // Nobody has signed in on this computer yet: a newcomer, so start on "Create account".
  useEffect(() => {
    try {
      if (localStorage.getItem(SIGNED_IN_BEFORE) !== "1") setMode("signup");
    } catch {
      /* storage unavailable: keep "Sign in" */
    }
  }, []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, rich } = useI18n();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === "signin" ? { action: "signin", email, password } : { action: "signup", name, email, password, acceptTerms: agree };
      const next = await api<AccountState>("/api/account", { method: "POST", body: JSON.stringify(body) });
      try {
        localStorage.setItem(SIGNED_IN_BEFORE, "1");
      } catch {
        /* storage unavailable */
      }
      await savePickedLanguage();
      onDone(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <LanguagePick />
        <div className="gate-hero">
          <Logo size={92} />
          <h1>{mode === "signin" ? t("auth.welcomeBack") : t("auth.meetTeam")}</h1>
          <p className="muted">{mode === "signin" ? t("auth.signInSub") : t("auth.signUpSub")}</p>
        </div>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => { setTouched(true); setMode("signin"); }}>{t("auth.signIn")}</button>
          <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => { setTouched(true); setMode("signup"); }}>{t("auth.createAccount")}</button>
        </div>
        <form onSubmit={submit} className="gate-form">
          {mode === "signup" && (
            <label className="field">
              {t("common.yourName")}
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={60} />
            </label>
          )}
          <label className="field">
            {t("auth.email")}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label className="field">
            {t("auth.password")}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} />
          </label>
          {mode === "signin" && (
            <a className="forgot-link" href={`${cloudUrl}/forgot-password`} target="_blank" rel="noreferrer noopener">
              {t("auth.forgot")}
            </a>
          )}
          {mode === "signup" && (
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
              <span>
                {rich("auth.agree", {
                  terms: <a href={`${cloudUrl}/terms`} target="_blank" rel="noreferrer noopener">{t("common.terms")}</a>,
                  privacy: <a href={`${cloudUrl}/privacy`} target="_blank" rel="noreferrer noopener">{t("common.privacy")}</a>,
                })}
              </span>
            </label>
          )}
          {error && <div className="notice error small">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy || (mode === "signup" && !agree)}>
            {busy ? t("auth.oneMoment") : mode === "signin" ? t("auth.signIn") : t("auth.createAccount")}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------- onboarding ----------

const STEPS = ["welcome", "you", "ai", "leader", "done"] as const;

function Onboarding({ account, onDone }: { account: AccountState; onDone: (s: AccountState) => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(account.user?.name ?? "");
  const [image, setImage] = useState<string | null>(account.user?.image ?? null);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  // New accounts start on theOovi; bringing an API key is optional.
  const [ownKey, setOwnKey] = useState(false);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [leader, setLeader] = useState<Bot | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    (async () => {
      try {
        const [bots, chats, main] = await Promise.all([
          api<Bot[]>("/api/bots"),
          api<ChatSummary[]>("/api/chats"),
          api<{ botId: string | null }>("/api/main").catch(() => ({ botId: null })),
        ]);
        // The bot set up here becomes the Chief (main bot): prefer the current one.
        const leadId = chats.find((c) => c.kind === "group")?.leadId;
        setLeader(bots.find((b) => b.id === main.botId) ?? bots.find((b) => b.id === leadId) ?? bots.find((b) => /leader/i.test(b.role)) ?? bots[0] ?? null);
      } catch {
        /* the leader step will offer to skip */
      }
    })();
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const saveProfile = () =>
    run(async () => {
      await api("/api/account", { method: "PATCH", body: JSON.stringify({ name, image }) });
      setStep(2);
    });

  // theOovi: no key to enter. Creating the credit account happens on the first status check.
  const startHosted = () =>
    run(async () => {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ active: "oovi" }) });
      await fetch("/api/credits?fresh=1", { cache: "no-store" }).catch(() => null);
      setStep(3);
    });

  const saveAi = (test: boolean) =>
    run(async () => {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ active: provider, providers: { [provider]: { apiKey: key || undefined, model: model || undefined } } }) });
      if (test) {
        const r = await api<{ ok: boolean; reply?: string; error?: string; model?: string }>("/api/settings/test", { method: "POST" });
        if (!r.ok) throw new Error(r.error ?? t("onb.noAnswer"));
        setMsg({ ok: true, text: t("onb.connected", { model: r.model ?? "" }) });
        setTimeout(() => setStep(3), 900);
      } else setStep(3);
    });

  const loadModels = () =>
    run(async () => {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ providers: { [provider]: { apiKey: key || undefined } } }) });
      const r = await api<{ models: { id: string }[] }>(`/api/models?provider=${provider}`);
      setModels(r.models.map((m) => m.id));
      if (!model && r.models[0]) setModel(r.models[0].id);
    });

  const saveLeader = () =>
    run(async () => {
      if (leader) {
        const { id, createdAt: _c, ...rest } = leader;
        await api(`/api/bots/${id}`, { method: "PUT", body: JSON.stringify(rest) });
        // The bot you set up is your Chief (main bot): it runs your groups and answers on Telegram.
        await api("/api/main", { method: "PUT", body: JSON.stringify({ botId: id }) }).catch(() => {});
      } else {
        // The bots weren't loaded in time: still pin a Chief so it's settled from the first sign-in.
        const main = await api<{ botId: string | null }>("/api/main").catch(() => ({ botId: null }));
        if (main.botId) await api("/api/main", { method: "PUT", body: JSON.stringify({ botId: main.botId }) }).catch(() => {});
      }
      setStep(4);
    });

  const finish = () => run(async () => onDone(await api<AccountState>("/api/account", { method: "POST", body: JSON.stringify({ action: "onboarded" }) })));

  const meta = PROVIDERS[provider];

  return (
    <div className="gate">
      <div className="gate-card wide">
        <ol className="steps-dots" aria-label={t("onb.progress")}>
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? "on" : i < step ? "done" : ""}>{t(`onb.step.${s}`)}</li>
          ))}
        </ol>

        {step === 0 && (
          <div className="onb">
            <Logo size={150} />
            <h1>{account.user?.name ? t("onb.hiName", { name: account.user.name.split(" ")[0] ?? "" }) : t("onb.hi")}</h1>
            <p className="muted">{t("onb.intro")}</p>
            <button className="btn primary" onClick={() => setStep(1)}>{t("onb.letsGo")} <Icon name="arrow" size={16} /></button>
          </div>
        )}

        {step === 1 && (
          <div className="onb">
            <h1>{t("onb.aboutTitle")}</h1>
            <p className="muted">{t("onb.aboutSub")}</p>
            <div className="avatar-pick">
              {image ? <img src={image} alt={t("common.yourPhoto")} className="avatar-img big" /> : <Face face={PHOTO_PLACEHOLDER} size={96} />}
              <div className="row-btns">
                <label className="btn sm">
                  {t("onb.choosePhoto")}
                  <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && setImage(await resizeImage(e.target.files[0]).catch(() => null))} />
                </label>
                {image && <button className="btn sm" onClick={() => setImage(null)}>{t("common.remove")}</button>}
              </div>
            </div>
            <label className="field">
              {t("common.yourName")}
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </label>
            <div className="row-btns">
              <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void saveProfile()}>{t("common.continue")}</button>
            </div>
          </div>
        )}

        {step === 2 && !ownKey && (
          <div className="onb">
            <h1>{t("onb.hostedTitle")}</h1>
            <p className="muted">{t("onb.hostedSub")}</p>
            <div className="hosted-start">
              <Icon name="spark" size={22} />
              <div>
                <b>{HOSTED_NAME}</b>
                <p className="muted">{t("onb.hostedPoints")}</p>
              </div>
            </div>
            {msg && <div className={`notice small${msg.ok ? "" : " error"}`}>{msg.text}</div>}
            <div className="row-btns">
              <button className="btn primary" disabled={busy} aria-busy={busy} onClick={() => void startHosted()}>
                {busy ? t("auth.oneMoment") : t("onb.hostedStart")} {!busy && <Icon name="arrow" size={16} />}
              </button>
              <button className="btn" disabled={busy} onClick={() => setOwnKey(true)}>{t("onb.useOwnKey")}</button>
            </div>
          </div>
        )}

        {step === 2 && ownKey && (
          <div className="onb">
            <h1>{t("onb.aiTitle")}</h1>
            <p className="muted">{t("onb.aiSub")}</p>
            <div className="grid">
              <label className="field">
                {t("common.provider")}
                <select value={provider} onChange={(e) => { setProvider(e.target.value as ProviderId); setModels([]); setModel(""); }}>
                  {PROVIDER_IDS.map((p) => (
                    <option key={p} value={p}>{PROVIDERS[p].label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t("common.apiKey")} {meta.keyUrl && <a href={meta.keyUrl} target="_blank" rel="noreferrer noopener">{t("common.getOne")}</a>}
                <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={meta.needsKey ? t("common.pasteKey") : t("common.notNeeded")} />
              </label>
              <label className="field full">
                {t("common.model")}
                {models.length ? (
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    {models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={meta.model || t("common.modelName")} />
                )}
              </label>
            </div>
            <div className="row-btns">
              <button className="btn sm" disabled={busy || (meta.needsKey && !key && provider !== "openrouter")} onClick={() => void loadModels()}>{t("onb.showModels")}</button>
            </div>
            {msg && <div className={`notice small${msg.ok ? "" : " error"}`}>{msg.text}</div>}
            <div className="row-btns">
              <button className="btn primary" disabled={busy || (meta.needsKey && !key)} onClick={() => void saveAi(true)}>{busy ? t("onb.checking") : t("onb.connectTest")}</button>
              <button className="btn" disabled={busy} onClick={() => setOwnKey(false)}>{t("onb.useHostedInstead")}</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onb">
            <h1>{t("onb.leaderTitle")}</h1>
            <p className="muted">{t("onb.leaderSub")}</p>
            {leader ? (
              <>
                <Face face={leader.face} size={150} mood="happy" interactive title={leader.name} />
                <div className="grid">
                  <label className="field">
                    {t("onb.leaderName")}
                    <input value={leader.name} maxLength={24} onChange={(e) => setLeader({ ...leader, name: e.target.value.replace(/\s+/g, "") })} />
                  </label>
                  <label className="field">
                    {t("onb.look")}
                    <button type="button" className="btn" onClick={() => setLeader({ ...leader, face: randomFace() })}>
                      <Icon name="shuffle" size={16} /> {t("onb.shuffle")}
                    </button>
                  </label>
                </div>
              </>
            ) : (
              <p className="note">{t("onb.stillCreating")}</p>
            )}
            {msg && <div className="notice error small">{msg.text}</div>}
            <div className="row-btns">
              <button className="btn primary" disabled={busy || (!!leader && !leader.name.trim())} onClick={() => void saveLeader()}>{t("common.continue")}</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="onb">
            <Logo size={130} />
            <h1>{name ? t("onb.doneName", { name: name.split(" ")[0] ?? "" }) : t("onb.done")}</h1>
            <p className="muted">{t("onb.doneSubChief", { name: leader?.name ?? "Oovi" })}</p>
            <div className="row-btns">
              <button className="btn primary" disabled={busy} aria-busy={busy} onClick={() => void finish()}>
                {busy ? t("auth.oneMoment") : t("onb.start")} {!busy && <Icon name="arrow" size={16} />}
              </button>
              {/* Reaching your Chief from the phone is what users love most: offer it right away (optional). */}
              <button className="btn" disabled={busy} onClick={() => void finish().then(() => openSettings("telegram"))}>
                {t("onb.connectPhone")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- the gate ----------

export default function AccountGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AccountState | null>(null);
  const [failed, setFailed] = useState(false);
  const { t } = useI18n();
  const loggedIn = !!state?.loggedIn;

  // A different account may have a different language: re-read it after signing in.
  useEffect(() => {
    if (loggedIn) announceLanguage();
  }, [loggedIn]);

  const load = useCallback(async () => {
    try {
      setState(await api<AccountState>("/api/account?refresh=1"));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const onSignOut = () => void load();
    window.addEventListener("oovi:account", onSignOut);
    const onError = (e: ErrorEvent) => reportCrash(e.message || "Unknown error", e.error instanceof Error ? e.error.stack : undefined);
    const onRejection = (e: PromiseRejectionEvent) => reportCrash(e.reason instanceof Error ? e.reason.message : String(e.reason), e.reason instanceof Error ? e.reason.stack : undefined);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("oovi:account", onSignOut);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [load]);

  if (!state) {
    return (
      <div className="gate">
        <div className="gate-splash">
          <Logo size={96} className="logo-pulse" />
          {failed && (
            <p className="muted">
              {t("gate.cantStart")} <button className="link-btn" onClick={() => { setFailed(false); void load(); }}>{t("gate.tryAgain")}</button>
            </p>
          )}
        </div>
      </div>
    );
  }
  if (!state.loggedIn) return <AuthScreen cloudUrl={state.cloudUrl} onDone={setState} />;
  if (!state.onboarded) return <Onboarding account={state} onDone={setState} />;
  return (
    <>
      {children}
      <SettingsModal />
    </>
  );
}
