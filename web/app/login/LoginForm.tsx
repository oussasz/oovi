"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function LoginForm({ next = null }: { next?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
    if (error) {
      setBusy(false);
      setError(error.status === 429 ? "Too many attempts. Please wait a minute." : "Invalid email or password.");
      return;
    }
    router.replace(next ?? "/account");
    router.refresh();
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
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <div className="field-head">
            <label htmlFor="password">Password</label>
            <Link href="/forgot-password" className="field-link">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-dark btn-lg" type="submit" disabled={busy || !email || !password}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="switch-line">
        New to oovi? <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>Create an account</Link>
      </p>
    </>
  );
}
