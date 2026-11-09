"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { EMAIL_RE } from "@/lib/validation";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) return setError("Please enter a valid email address.");
    setBusy(true);
    try {
      const { error } = await authClient.requestPasswordReset({ email: value, redirectTo: "/reset-password" });
      // Same answer whether or not an account exists, so nobody can test addresses here.
      if (error?.status === 429) {
        setError("Too many requests. Please wait a minute and try again.");
        return;
      }
      setSentTo(value);
    } catch {
      setError("Couldn’t reach oovi. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="form">
        <p className="alert alert-ok" role="status">
          If an account exists for {sentTo}, we sent a link to reset the password.
        </p>
        <p className="fine">The link works for 1 hour. Nothing there after a few minutes? Check your spam folder, or try again.</p>
        <button
          type="button"
          className="btn btn-light btn-lg"
          onClick={() => {
            setSentTo(null);
            setError(null);
          }}
        >
          Use a different email
        </button>
        <p className="switch-line" style={{ marginTop: 4 }}>
          Remembered it? <Link href="/login">Log in</Link>
        </p>
      </div>
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
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button className="btn btn-dark btn-lg" type="submit" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="switch-line">
        Remembered it? <Link href="/login">Log in</Link>
      </p>
    </>
  );
}
