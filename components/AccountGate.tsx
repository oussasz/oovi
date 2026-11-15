"use client";

// Everything in oovi belongs to an account. This gate shows, in order:
//   splash → sign in / create account → onboarding (first time) → the app.
// It also reports unexpected UI errors (crash reports) and hosts the Settings window.

import { isRealCrash } from "@/lib/crash-filter";
import { useCallback, useEffect, useState } from "react";
import { api, resizeImage } from "@/lib/client";
import { randomFace, type Face as FaceT } from "@/lib/faces";
import { GOALS, LEADERS } from "@/lib/onboarding-core";
import { LOCALES, NATIVE_NAMES } from "@/lib/i18n";
import { HOSTED_NAME, PROVIDER_IDS, PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import type { Bot, ChatSummary } from "@/lib/types";
import Face, { FaceStack } from "./Face";
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
  // The email must be confirmed before the account opens: the 6-digit code from the email.
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const { t, rich } = useI18n();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const body = codeFor
        ? { action: "verify", email: codeFor, code }
        : mode === "signin"
          ? { action: "signin", email, password }
          : { action: "signup", name, email, password, acceptTerms: agree };
      const next = await api<AccountState & { verify?: { email: string } }>("/api/account", { method: "POST", body: JSON.stringify(body) });
      if (next.verify) {
        setCodeFor(next.verify.email);
        setCode("");
        return;
      }
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

  async function resend() {
    if (!codeFor) return;
    setError(null);
    setSent(false);
    try {
      await api("/api/account", { method: "POST", body: JSON.stringify({ action: "resend", email: codeFor }) });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (codeFor) {
    return (
      <div className="gate">
        <div className="gate-card">
          <LanguagePick />
          <div className="gate-hero">
            <Logo size={92} />
            <h1>{t("auth.codeTitle")}</h1>
            <p className="muted">{rich("auth.codeSub", { email: <b>{codeFor}</b> })}</p>
          </div>
          <form onSubmit={submit} className="gate-form">
            <label className="field">
              {t("auth.code")}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                dir="ltr"
                className="code-input"
              />
            </label>
            {error && <div className="notice error small">{error}</div>}
            {sent && <div className="notice small" role="status">{t("auth.codeSent")}</div>}
            <button className="btn primary" type="submit" disabled={busy || code.length !== 6}>
              {busy ? t("auth.oneMoment") : t("auth.codeConfirm")}
            </button>
            <div className="gate-links">
              <button type="button" className="linkish" onClick={() => void resend()}>{t("auth.codeResend")}</button>
              <button type="button" className="linkish" onClick={() => { setCodeFor(null); setError(null); setSent(false); }}>{t("auth.codeBack")}</button>
            </div>
          </form>
        </div>
      </div>
    );
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
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} maxLength={128} aria-describedby={mode === "signup" ? "pw-hint" : undefined} />
            {mode === "signup" && <small id="pw-hint" className="muted">{t("auth.passwordHint")}</small>}
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

const STEPS = ["you", "leader", "goals", "team", "ready"] as const;

type Leader = (typeof LEADERS)[number];
type Suggested = { id: string; name: string; description: string; group: boolean; bots: { name: string; role: string; face: FaceT }[] };
type Applied = { leader: { id: string; name: string }; created: { id: string; name: string; groupId: string; bots: string[] }[]; starter: boolean; failed: string[] };

/** What the Chief says, with its face: the questions come from the character the user chose. */
function ChiefSays({ face, name, children }: { face: FaceT; name: string; children: React.ReactNode }) {
  return (
    <div className="chief-says">
      <Face face={face} size={64} mood="happy" />
      <div className="chief-bubble">
        <b>{name}</b>
        <div>{children}</div>
      </div>
    </div>
  );
}

/**
 * First run, made personal (lib/onboarding-core.ts): who you are → the character of your Chief → what you'll use
 * oovi for (your Chief asks) → the team it suggests for that → ready. theOovi is set up by itself (no key needed);
 * your own API key stays one click away in Settings.
 */
function Onboarding({ account, onDone }: { account: AccountState; onDone: (s: AccountState) => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(account.user?.name ?? "");
  const [image, setImage] = useState<string | null>(account.user?.image ?? null);
  const [style, setStyle] = useState<Leader["id"]>("calm");
  const [chiefName, setChiefName] = useState<string>(LEADERS[0].name);
  const [face, setFace] = useState<FaceT>({ ...LEADERS[0].face });
  const [goals, setGoals] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [setups, setSetups] = useState<Suggested[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { t } = useI18n();
  const first = name.trim().split(/\s+/)[0] ?? "";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // About you. Your bots run on theOovi from the start: no key to find, nothing to choose.
  const saveProfile = () =>
    run(async () => {
      await api("/api/account", { method: "PATCH", body: JSON.stringify({ name, image }) });
      await api("/api/settings", { method: "POST", body: JSON.stringify({ active: "oovi" }) }).catch(() => {});
      void fetch("/api/credits?fresh=1", { cache: "no-store" }).catch(() => null);
      setStep(1);
    });

  const pickStyle = (l: Leader) => {
    // A name the user typed stays; the character's own name follows the character.
    if (!chiefName.trim() || LEADERS.some((x) => x.name === chiefName)) setChiefName(l.name);
    setStyle(l.id);
    setFace({ ...l.face });
  };

  // Your Chief suggests a team for what you said.
  const suggest = () =>
    run(async () => {
      setSetups(null);
      setStep(3);
      const r = await api<{ setups: Suggested[]; picked: string[] }>(`/api/onboarding?goals=${encodeURIComponent(goals.join(","))}&other=${encodeURIComponent(other)}`);
      setSetups(r.setups);
      setPicked(r.picked);
    });

  const apply = (ids: string[]) =>
    run(async () => {
      const r = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ style, name: chiefName, face, goals, other, setups: ids }) });
      const j = (await r.json().catch(() => null)) as (Applied & { error?: string; done?: Applied }) | null;
      if (r.status === 409 && j?.done) setApplied(j.done);
      else if (!r.ok || !j) throw new Error(j?.error ?? t("onb.teamError"));
      else setApplied(j);
      setStep(4);
    });

  const finish = () => run(async () => onDone(await api<AccountState>("/api/account", { method: "POST", body: JSON.stringify({ action: "onboarded" }) })));
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const back = step > 0 && step < 4 && (
    <button type="button" className="link-btn muted onb-back" onClick={() => setStep(step - 1)} disabled={busy}>
      {t("onb.back")}
    </button>
  );

  return (
    <div className="gate">
      <div className="gate-card wide">
        <ol className="steps-dots" aria-label={t("onb.progress")}>
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>{t(`onb.step.${s}`)}</li>
          ))}
        </ol>

        {step === 0 && (
          <div className="onb">
            <Logo size={110} />
            <h1>{first ? t("onb.youTitle", { name: first }) : t("onb.youTitleNoName")}</h1>
            <p className="muted">{t("onb.youSub")}</p>
            <div className="avatar-pick">
              {image ? <img src={image} alt={t("common.yourPhoto")} className="avatar-img big" /> : <Face face={PHOTO_PLACEHOLDER} size={80} />}
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
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
            </label>
            {msg && <div className="notice error small">{msg}</div>}
            <div className="row-btns">
              <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void saveProfile()}>
                {t("common.continue")} <Icon name="arrow" size={16} />
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onb">
            <h1>{t("onb.chiefTitle")}</h1>
            <p className="muted">{t("onb.chiefSub")}</p>
            <div className="chief-pick" role="radiogroup" aria-label={t("onb.chiefTitle")}>
              {LEADERS.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={style === l.id} className={`chief-card${style === l.id ? " on" : ""}`} onClick={() => pickStyle(l)}>
                  <Face face={style === l.id ? face : l.face} size={60} mood={style === l.id ? "happy" : "idle"} />
                  <b>{style === l.id ? chiefName || l.name : l.name}</b>
                  <small>{t(`onb.style.${l.id}`)}</small>
                </button>
              ))}
            </div>
            <div className="chief-edit">
              <label className="field">
                {t("onb.leaderName")}
                <input value={chiefName} maxLength={24} onChange={(e) => setChiefName(e.target.value.replace(/\s+/g, ""))} />
              </label>
              <button type="button" className="btn" onClick={() => setFace(randomFace())}>
                <Icon name="shuffle" size={16} /> {t("onb.shuffle")}
              </button>
            </div>
            <div className="row-btns">
              <button className="btn primary" disabled={!/^[\p{L}\p{N}_-]{1,24}$/u.test(chiefName)} onClick={() => setStep(2)}>
                {t("common.continue")} <Icon name="arrow" size={16} />
              </button>
            </div>
            {back}
          </div>
        )}

        {step === 2 && (
          <div className="onb">
            <ChiefSays face={face} name={chiefName}>
              <p className="chief-q">{first ? t("onb.goalsAsk", { name: first, chief: chiefName }) : t("onb.goalsAskNoName", { chief: chiefName })}</p>
              <p className="muted">{t("onb.goalsSub")}</p>
            </ChiefSays>
            <div className="goal-chips" role="group" aria-label={t("onb.step.goals")}>
              {GOALS.map((g) => (
                <button key={g.id} type="button" aria-pressed={goals.includes(g.id)} className={`goal-chip${goals.includes(g.id) ? " on" : ""}`} onClick={() => setGoals((x) => toggle(x, g.id))}>
                  {goals.includes(g.id) && <Icon name="check" size={14} />} {t(`onb.goal.${g.id}`)}
                </button>
              ))}
            </div>
            <label className="field">
              {t("onb.goalOther")}
              <input value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} placeholder={t("onb.goalOtherHint")} />
            </label>
            {msg && <div className="notice error small">{msg}</div>}
            <div className="row-btns">
              <button className="btn primary" disabled={busy} onClick={() => void suggest()}>
                {goals.length || other.trim() ? t("onb.seeTeam") : t("onb.skipGoals")} <Icon name="arrow" size={16} />
              </button>
            </div>
            {back}
          </div>
        )}

        {step === 3 && (
          <div className="onb">
            <ChiefSays face={face} name={chiefName}>
              <p className="chief-q">{t("onb.teamSay")}</p>
              <p className="muted">{t("onb.teamSub")}</p>
            </ChiefSays>
            {!setups ? (
              <p className="note" aria-live="polite">{t("onb.loadingTeam")}</p>
            ) : (
              <div className="team-suggest">
                {setups.map((s) => {
                  const on = picked.includes(s.id);
                  return (
                    <label key={s.id} className={`team-card${on ? " on" : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => setPicked((x) => toggle(x, s.id))} />
                      <FaceStack faces={s.bots.map((b) => b.face)} size={52} />
                      <span className="team-card-text">
                        <b>{s.name}</b>
                        <small className="team-card-tag">{s.group ? t("onb.teamOf", { count: s.bots.length }) : t("onb.expert")}</small>
                        <span className="muted">{s.description}</span>
                      </span>
                      <span className="team-check" aria-hidden>{on && <Icon name="check" size={16} />}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {msg && <div className="notice error small">{msg}</div>}
            <div className="row-btns">
              <button className="btn primary" disabled={busy || !setups || !picked.length} aria-busy={busy} onClick={() => void apply(picked)}>
                {busy ? t("onb.creating") : t("onb.createTeam")} {!busy && <Icon name="arrow" size={16} />}
              </button>
              <button className="btn" disabled={busy || !setups} onClick={() => void apply([])}>{t("onb.justMe")}</button>
            </div>
            {back}
          </div>
        )}

        {step === 4 && (
          <div className="onb">
            <div className="ready-faces">
              <Face face={face} size={84} mood="happy" />
            </div>
            <h1>{first ? t("onb.readyTitle", { name: first }) : t("onb.readyTitleNoName")}</h1>
            <p className="muted">{t("onb.readySub", { chief: applied?.leader.name ?? chiefName })}</p>
            {!!applied?.created.length && (
              <ul className="ready-team">
                {applied.created.map((c) => (
                  <li key={c.id}><Icon name="check" size={14} /> {c.name}</li>
                ))}
                {applied.starter && <li><Icon name="check" size={14} /> {t("onb.starterTeam")}</li>}
              </ul>
            )}
            {!!applied?.failed.length && <div className="notice small">{t("onb.teamFailed", { names: applied.failed.join(", ") })}</div>}
            <p className="fine muted">{t("onb.readyHosted")}</p>
            {msg && <div className="notice error small">{msg}</div>}
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
