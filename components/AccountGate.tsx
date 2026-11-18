"use client";

// Everything in oovi belongs to an account. This gate shows, in order:
//   splash → sign in / create account → onboarding (first time) → the app.
// It also reports unexpected UI errors (crash reports) and hosts the Settings window.

import EditorModal from "./EditorModal";
import { isRealCrash } from "@/lib/crash-filter";
import { useCallback, useEffect, useState } from "react";
import CloudAsk, { CloudQuestion } from "./CloudAsk";
import { api } from "@/lib/client";
import { randomFace, type Face as FaceT } from "@/lib/faces";
import { GOALS, LEADERS } from "@/lib/onboarding-core";
import { LOCALES, NATIVE_NAMES, setupText } from "@/lib/i18n";
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

const STEPS = ["leader", "team", "sync"] as const;

type Leader = (typeof LEADERS)[number];
type Suggested = { id: string; name: string; description: string; group: boolean; bots: { name: string; role: string; face: FaceT }[] };
type Applied = { leader: { id: string; name: string }; created: { id: string; name: string; groupId: string; bots: string[] }[]; starter: boolean; failed: string[]; goals?: string[] };

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

/** Tells oovi's server which first-run step was reached (Admin > Overview). Never in the way. */
const reach = (step: "chief" | "team" | "created" | "alone" | "tried" | "later", extra: Record<string, unknown> = {}) =>
  void fetch("/api/onboarding", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ step, ...extra }) }).catch(() => {});

/**
 * First run, made personal, in two screens (lib/onboarding-core.ts):
 *   1. your Chief: its character and name (the name you signed up with greets you; theOovi is set up by itself),
 *   2. what you're curious about: your Chief asks, and the team it suggests appears and updates as you tap
 *      (or skip and explore).
 * Then the home screen, with your Chief and ideas that fit (it already offers them: no extra screen for that).
 * Nothing here is a commitment: the goals say where someone starts, and the Chief follows what they ask later.
 */
function Onboarding({ account, onDone }: { account: AccountState; onDone: (s: AccountState) => void }) {
  const [step, setStep] = useState(0);
  const [style, setStyle] = useState<Leader["id"]>("calm");
  const [chiefName, setChiefName] = useState<string>(LEADERS[0].name);
  const [face, setFace] = useState<FaceT>({ ...LEADERS[0].face });
  const [goals, setGoals] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [setups, setSetups] = useState<Suggested[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { t } = useI18n();
  const first = (account.user?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const wantsTeam = goals.length > 0 || other.trim().length >= 3;

  // Closed after the team was made but before the app opened: open it now (the choices are saved).
  useEffect(() => {
    api<{ done: Applied | null }>("/api/onboarding?mine=1")
      .then((r) => {
        if (r.done?.leader) void finish();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const pickStyle = (l: Leader) => {
    // A name the user typed stays; the character's own name follows the character.
    if (!chiefName.trim() || LEADERS.some((x) => x.name === chiefName)) setChiefName(l.name);
    setStyle(l.id);
    setFace({ ...l.face });
  };

  // Screen 1 → 2. Your bots run on theOovi from the start: no key to find, nothing to choose.
  const toGoals = () => {
    void api("/api/settings", { method: "POST", body: JSON.stringify({ active: "oovi" }) }).catch(() => {});
    void fetch("/api/credits?fresh=1", { cache: "no-store" }).catch(() => null);
    reach("chief", { style });
    reach("team");
    setStep(1);
  };

  // The suggested team follows the goals as they are tapped (a short pause while typing).
  useEffect(() => {
    if (step !== 1) return;
    if (!wantsTeam) {
      setSetups(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api<{ setups: Suggested[]; picked: string[] }>(`/api/onboarding?goals=${encodeURIComponent(goals.join(","))}&other=${encodeURIComponent(other.trim())}`)
        .then((r) => {
          if (!alive) return;
          setSetups(r.setups);
          // Until the user ticks or unticks something, the best fit is ticked; after that, their choices stay.
          setPicked((cur) => (touched ? cur.filter((id) => r.setups.some((x) => x.id === id)) : r.picked));
        })
        .catch(() => alive && setSetups([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [step, goals, other, wantsTeam, touched]);

  // Screen 2 → 3: the choices are applied once; the first task is ready from the first goal.
  const apply = (ids: string[]) =>
    run(async () => {
      const r = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ style, name: chiefName, face, goals, other, setups: ids }) });
      const j = (await r.json().catch(() => null)) as (Applied & { error?: string; done?: Applied }) | null;
      const done = r.status === 409 && j?.done ? j.done : r.ok && j ? j : null;
      if (!done) throw new Error(j?.error ?? t("onb.teamError"));
      reach(ids.length ? "created" : "alone", { goals, setups: ids });
      // Last screen: the cloud sync question (Turn on / Stay local).
      setStep(2);
    });

  const finish = async () => onDone(await api<AccountState>("/api/account", { method: "POST", body: JSON.stringify({ action: "onboarded" }) }));

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

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
            <h1>{first ? t("onb.hiChief", { name: first }) : t("onb.chiefTitle")}</h1>
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
              <button className="btn primary" disabled={!/^[\p{L}\p{N}_-]{1,24}$/u.test(chiefName)} onClick={toGoals}>
                {t("common.continue")} <Icon name="arrow" size={16} />
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onb">
            <ChiefSays face={face} name={chiefName}>
              <p className="chief-q">{first ? t("onb.goalsAsk", { name: first, chief: chiefName }) : t("onb.goalsAskNoName", { chief: chiefName })}</p>
              <p className="muted">{t("onb.goalsSub")}</p>
            </ChiefSays>
            <div className="goal-chips" role="group" aria-label={t("onb.step.team")}>
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

            <div className="team-live" aria-live="polite" aria-busy={loading}>
              <h2 className="team-live-h">{t("onb.teamLive")}</h2>
              {!wantsTeam ? (
                <p className="note">{t("onb.teamHint", { chief: chiefName })}</p>
              ) : !setups ? (
                <p className="note">{t("onb.loadingTeam")}</p>
              ) : (
                <div className={`team-suggest${loading ? " refreshing" : ""}`}>
                  {setups.map((s) => {
                    const on = picked.includes(s.id);
                    return (
                      <label key={s.id} className={`team-card${on ? " on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            setTouched(true);
                            setPicked((x) => toggle(x, s.id));
                          }}
                        />
                        <FaceStack faces={s.bots.map((b) => b.face)} size={48} />
                        <span className="team-card-text">
                          <b>{setupText(t, s.id, "name", s.name)}</b>
                          <small className="team-card-tag">{s.group ? t("onb.teamOf", { count: s.bots.length }) : t("onb.expert")}</small>
                          <span className="muted">{setupText(t, s.id, "desc", s.description)}</span>
                        </span>
                        <span className="team-check" aria-hidden>{on && <Icon name="check" size={16} />}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            {msg && <div className="notice error small">{msg}</div>}
            <div className="row-btns">
              <button className="btn primary" disabled={busy || !wantsTeam || !picked.length} aria-busy={busy} onClick={() => void apply(picked)}>
                {busy ? t("onb.creating") : t("onb.createTeam")} {!busy && <Icon name="arrow" size={16} />}
              </button>
              <button className="btn" disabled={busy} onClick={() => void apply([])}>{t("onb.justMe")}</button>
            </div>
            <button type="button" className="link-btn muted onb-back" onClick={() => setStep(0)} disabled={busy}>
              {t("onb.back")}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="onb">
            <CloudQuestion onDone={() => void run(finish)} />
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
      <CloudAsk />
      <SettingsModal />
      <EditorModal />
    </>
  );
}
