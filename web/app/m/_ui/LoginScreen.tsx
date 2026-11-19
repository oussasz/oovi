"use client";

// Sign in, or create an account, with the website's own sign-in service (better-auth, lib/auth-client.ts): the same
// account as the desktop app. The website has no sign-in page any more (owner, 2026-11-19): signing up happens here,
// with the same checks the website's sign-up had (name, email, 8+ character password, 18+ and the terms, then the
// 6-digit code from the email when confirmation is on).
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { TERMS_VERSION } from "@/lib/legal";
import { firstTouch } from "@/components/FirstTouch";
import { safeMobileNext } from "../_lib/core";
import { tap } from "../_lib/haptics";
import { SlimeTrio, Spinner } from "./kit";
import { useM } from "./MobileApp";

type Mode = "in" | "up" | "code";

export function LoginScreen() {
  const { t, refresh, toast } = useM();
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mail = email.trim().toLowerCase();

  const done = (welcome = false) => {
    tap("success");
    router.replace(safeMobileNext(params.get("next")));
    void refresh({ setup: true });
    if (welcome) toast(t("acct.welcome"));
  };
  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setNote(null);
  };

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await authClient.signIn.email({ email: mail, password });
      if (err) {
        tap("warning");
        setBusy(false);
        setError(err.status === 429 ? t("login.tooMany") : t("login.invalid"));
        return;
      }
    } catch {
      setBusy(false);
      setError(t("login.network"));
      return;
    }
    done();
  }

  async function signUp(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!name.trim()) return setError(t("login.errName"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return setError(t("login.errEmail"));
    if (password.length < 8) return setError(t("login.errPw"));
    if (!agree) return setError(t("login.errAgree"));
    setBusy(true);
    try {
      const ref = firstTouch();
      const { error: err } = await authClient.signUp.email({ name: name.trim(), email: mail, password, termsVersion: TERMS_VERSION, fetchOptions: { headers: ref ? { "x-oovi-ref": ref } : {} } } as Parameters<typeof authClient.signUp.email>[0]);
      if (err) {
        tap("warning");
        setBusy(false);
        const msg = err.message ?? "";
        setError(err.code?.startsWith("USER_ALREADY_EXISTS") || /already exists/i.test(msg) ? t("login.exists") : err.status === 429 ? t("login.tooMany") : msg || t("login.upFailed"));
        return;
      }
    } catch {
      setBusy(false);
      setError(t("login.network"));
      return;
    }
    const needs = await fetch("/api/v1/auth/verification")
      .then((r) => r.json())
      .catch(() => ({ required: false }));
    setBusy(false);
    if ((needs as { required?: boolean })?.required) return switchTo("code");
    done(true);
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNote(null);
    if (!/^\d{6}$/.test(code.trim())) return setError(t("login.codeBad"));
    setBusy(true);
    const r = await fetch("/api/v1/auth/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: mail, code: code.trim() }) }).catch(() => null);
    const j = (r ? await r.json().catch(() => ({})) : {}) as { error?: string };
    setBusy(false);
    if (!r || !r.ok) return setError(j.error || t("login.network"));
    done(true);
  }

  async function resend() {
    setError(null);
    setNote(null);
    const r = await fetch("/api/v1/auth/resend-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: mail }) }).catch(() => null);
    if (r && (r.ok || r.status === 204)) setNote(t("login.resent"));
    else setError(((r ? await r.json().catch(() => ({})) : {}) as { error?: string }).error || t("login.network"));
  }

  const alert = error && (
    <p className="m-alert" role="alert">
      {error}
    </p>
  );

  return (
    <div className="m-screen m-screen--login">
      <main className="m-login">
        <div className="m-login__brand">
          <SlimeTrio mood="happy" size={mode === "in" ? 132 : 96} />
          <h1>{t(mode === "in" ? "login.title" : mode === "up" ? "login.upTitle" : "login.codeTitle")}</h1>
          <p>{mode === "in" ? t("login.sub") : mode === "up" ? t("login.upSub") : t("login.codeSub", { email: mail })}</p>
        </div>

        {mode === "in" && (
          <>
            <form onSubmit={signIn} noValidate>
              {alert}
              <div className="m-group m-group--form">
                <label className="m-field">
                  <span>{t("login.email")}</span>
                  <input type="email" inputMode="email" placeholder="name@example.com" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label className="m-field">
                  <span>{t("login.password")}</span>
                  <input type="password" autoComplete="current-password" dir="ltr" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              </div>
              <button className="m-btn m-btn--fill m-btn--wide m-btn--lg" type="submit" disabled={busy || !email.trim() || !password}>
                {busy ? <Spinner size={18} /> : t("login.submit")}
              </button>
            </form>
            <p className="m-login__links">
              <a href="/forgot-password">{t("login.forgot")}</a>
            </p>
            <p className="m-login__links">
              {t("login.new")}{" "}
              <button type="button" className="m-linkbtn" onClick={() => switchTo("up")}>
                {t("login.create")}
              </button>
            </p>
          </>
        )}

        {mode === "up" && (
          <>
            <form onSubmit={signUp} noValidate>
              {alert}
              <div className="m-group m-group--form">
                <label className="m-field">
                  <span>{t("login.name")}</span>
                  <input autoComplete="name" dir="auto" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="m-field">
                  <span>{t("login.email")}</span>
                  <input type="email" inputMode="email" placeholder="name@example.com" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label className="m-field">
                  <span>{t("login.password")}</span>
                  <input type="password" autoComplete="new-password" dir="ltr" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              </div>
              <label className="m-agree">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>
                  {t("login.agree")}{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer">
                    {t("login.terms")}
                  </a>{" "}
                  {t("login.and")}{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer">
                    {t("login.privacy")}
                  </a>
                  .
                </span>
              </label>
              <button className="m-btn m-btn--fill m-btn--wide m-btn--lg" type="submit" disabled={busy}>
                {busy ? <Spinner size={18} /> : t("login.upSubmit")}
              </button>
            </form>
            <p className="m-login__links">
              {t("login.have")}{" "}
              <button type="button" className="m-linkbtn" onClick={() => switchTo("in")}>
                {t("login.signIn")}
              </button>
            </p>
          </>
        )}

        {mode === "code" && (
          <form onSubmit={confirm} noValidate>
            {alert}
            {note && (
              <p className="m-okay" role="status">
                {note}
              </p>
            )}
            <div className="m-group m-group--form">
              <label className="m-field">
                <span>{t("login.code")}</span>
                <input inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </label>
            </div>
            <button className="m-btn m-btn--fill m-btn--wide m-btn--lg" type="submit" disabled={busy || code.length !== 6}>
              {busy ? <Spinner size={18} /> : t("login.codeSubmit")}
            </button>
            <p className="m-login__links">
              <button type="button" className="m-linkbtn" onClick={() => void resend()}>
                {t("login.resend")}
              </button>
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
