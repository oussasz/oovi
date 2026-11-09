import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { ResetForm } from "./ResetForm";

// The token is in the address: don't pass it on to other sites.
export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[A-Za-z0-9_-]{8,200}$/;

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const valid = !error && typeof token === "string" && TOKEN_RE.test(token);

  if (!valid) {
    return (
      <AuthShell>
        <h1>This link doesn’t work</h1>
        <p className="sub">
          {error || token
            ? "The reset link has expired or was already used. Links work for 1 hour and only once."
            : "This page needs the link from your reset email. Open the email and press the button again."}
        </p>
        <Link href="/forgot-password" className="btn btn-dark btn-lg btn-block">
          Get a new link
        </Link>
        <p className="switch-line">
          Remembered it? <Link href="/login">Log in</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <ResetForm token={token} />
    </AuthShell>
  );
}
