"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { MAX_PASSWORD, MIN_PASSWORD } from "@/lib/validation";

type Phase = "form" | "done" | "expired";

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Your new password needs at least ${MIN_PASSWORD} characters.`);
    if (password.length > MAX_PASSWORD) return setError(`Your new password can be at most ${MAX_PASSWORD} characters.`);
    if (password !== confirm) return setError("The two passwords don’t match.");
    setBusy(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (!error) {
        setPhase("done");
        return;
      }
      if (error.status === 429) setError("Too many attempts. Please wait a minute and try again.");
      else if (error.code === "INVALID_TOKEN" || /token/i.test(error.message ?? "")) setPhase("expired");
      else setError(error.message || "Couldn’t change your password. Please try again.");
    } catch {
      setError("Couldn’t reach oovi. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "done") {
    return (
      <>
        <span className="done-badge" aria-hidden>
          ✓
        </span>
        <h1>Password changed</h1>
        <p className="sub">You’ve been signed out on your other devices. Log in with your new password.</p>
        <Link href="/login" className="btn btn-dark btn-lg btn-block">
          Log in
        </Link>
      </>
    );
  }

  if (phase === "expired") {
    return (
      <>
        <h1>This link doesn’t work</h1>
        <p className="sub">The reset link has expired or was already used. Links work for 1 hour and only once.</p>
        <Link href="/forgot-password" className="btn btn-dark btn-lg btn-block">
          Get a new link
        </Link>
      </>
    );
  }

  return (
    <>
      <h1>Choose a new password</h1>
      <p className="sub">Pick something you don’t use anywhere else.</p>
      <form className="form" onSubmit={onSubmit} noValidate>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            maxLength={MAX_PASSWORD}
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="new-password-hint"
          />
          <small id="new-password-hint" className="fine">
            At least {MIN_PASSWORD} characters.
          </small>
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Type it again</label>
          <input
            id="confirm-password"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            maxLength={MAX_PASSWORD}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button className="btn btn-dark btn-lg" type="submit" disabled={busy || !password || !confirm}>
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
    </>
  );
}
