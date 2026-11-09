"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { TERMS_VERSION } from "@/lib/legal";

export function SignupForm({ next = null }: { next?: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    router.replace(next ?? "/account?welcome=1");
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
