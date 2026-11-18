"use client";

// Sign in with the website's own sign-in (better-auth, lib/auth-client.ts): the same account and session as the
// website. On an iPhone, an app added to the Home Screen keeps its own cookies, so it signs in once here.
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { safeMobileNext } from "../_lib/core";
import { tap } from "../_lib/haptics";
import { Spinner } from "./kit";
import { useM } from "./MobileApp";

export function LoginScreen() {
  const { t, refresh } = useM();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
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
    tap("success");
    router.replace(safeMobileNext(params.get("next")));
    void refresh({ setup: true });
  }

  return (
    <div className="m-screen m-screen--login">
      <main className="m-login">
        <div className="m-login__brand">
          <Image src="/m/icon-192.png" alt="" width={84} height={84} priority />
          <h1>{t("login.title")}</h1>
          <p>{t("login.sub")}</p>
        </div>
        <form onSubmit={onSubmit} noValidate>
          {error && (
            <p className="m-alert" role="alert">
              {error}
            </p>
          )}
          <div className="m-group m-group--form">
            <label className="m-field">
              <span>{t("login.email")}</span>
              <input type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
          {t("login.new")} <a href="/signup?next=/m">{t("login.create")}</a>
        </p>
      </main>
    </div>
  );
}
