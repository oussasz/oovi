"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { TERMS_VERSION } from "@/lib/legal";
import { firstTouch } from "@/components/FirstTouch";

export function SignupForm({ next = null }: { next?: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Confirmation required: the account opens once the 6-digit code from the email is typed here.
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Please enter a valid email address.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (!agree) return setError("Please accept the Terms of Service and Privacy Policy.");
    setBusy(true);
    const { error } = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      termsVersion: TERMS_VERSION,
      // Where this person came from, for the admin console. Only sent here, once, when they sign up.
      fetchOptions: { headers: firstTouch() ? { "x-oovi-ref": firstTouch()! } : {} },
    });
    if (error) {
      setBusy(false);
      const msg = error.message ?? "";
      if (error.code?.startsWith("USER_ALREADY_EXISTS") || /already exists/i.test(msg)) {
        setError("An account with this email already exists. Try logging in.");
      } else {
        setError(msg || "Could not create your account. Please try again.");
      }
      return;
    }
    const needs = await fetch("/api/v1/auth/verification").then((r) => r.json()).catch(() => ({ required: false }));
    if (needs?.required) {
      setBusy(false);
      setCodeFor(email.trim().toLowerCase());
      return;
    }
    router.replace(next ?? "/account?welcome=1");
    router.refresh();
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    if (!/^\d{6}$/.test(code.trim())) return setError("The code has 6 digits.");
    setBusy(true);
    const r = await fetch("/api/v1/auth/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: codeFor, code: code.trim() }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r || !r.ok) return setError((j as { error?: string }).error || "Couldn't check the code. Please try again.");
    router.replace(next ?? "/account?welcome=1");
    router.refresh();
  }

  async function resend() {
    setError(null);
    setSent(null);
    const r = await fetch("/api/v1/auth/resend-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: codeFor }) }).catch(() => null);
    if (r && (r.ok || r.status === 204)) setSent("A new code is on its way. Check your inbox and spam folder.");
    else setError(((r ? await r.json().catch(() => ({})) : {}) as { error?: string }).error || "Couldn't send a new code. Please try again.");
  }

  if (codeFor) {
    return (
      <form className="form" onSubmit={confirm} noValidate>
        <p>
          We sent a 6-digit code to <b>{codeFor}</b>. Type it here to confirm your email and open your account.
        </p>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {sent && (
          <p className="alert" role="status">
            {sent}
          </p>
        )}
        <div className="field">
          <label htmlFor="code">Code</label>
          <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          <small className="fine">The code works for 1 hour. You can also click the button in the email.</small>
        </div>
        <button className="btn btn-dark btn-lg" type="submit" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Confirm my email"}
        </button>
        <p className="switch-line">
          No email? <button type="button" className="link-button" onClick={() => void resend()}>Send a new code</button>
        </p>
      </form>
    );
  }

  return (
    <>
      <form className="form" onSubmit={onSubmit} noValidate>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            className="input"
            autoComplete="name"
            maxLength={80}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="pw-hint"
          />
          <small id="pw-hint" className="fine">At least 8 characters.</small>
        </div>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
          <span>
            I agree to the{" "}
            <Link href="/terms" target="_blank">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <button className="btn btn-dark btn-lg" type="submit" disabled={busy || !agree}>
          {busy ? "Creating your account…" : "Create account"}
        </button>
      </form>
      <p className="switch-line">
        Already have an account? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Log in</Link>
      </p>
    </>
  );
}
