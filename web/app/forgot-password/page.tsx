import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { CONTACT_EMAIL } from "@/lib/legal";
import { smtpStatus } from "@/lib/mail";
import { ForgotForm } from "./ForgotForm";

export const metadata: Metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const ready = await smtpStatus()
    .then((s) => s.ready)
    .catch(() => false);
  return (
    <AuthShell>
      <h1>Forgot your password?</h1>
      {ready ? (
        <>
          <p className="sub">Enter the email you use for oovi and we’ll send you a link to choose a new one.</p>
          <ForgotForm />
        </>
      ) : (
        <>
          <p className="sub">Password reset by email isn’t available right now.</p>
          <p className="fine">
            Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from your account’s email address and we’ll help you get back in.
          </p>
          <p className="switch-line">
            <Link href="/login">Back to log in</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
