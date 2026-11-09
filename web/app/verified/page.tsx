import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { ResendVerification } from "@/components/ResendVerification";
import { getServerSession } from "@/lib/session";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function errorText(code: string): string {
  if (code === "TOKEN_EXPIRED") return "This link has expired. Confirmation links work for 24 hours.";
  if (code === "USER_NOT_FOUND") return "We couldn’t find the account for this link. It may have been deleted.";
  return "This link doesn’t work anymore. It may have been used already, or only part of it was copied.";
}

export default async function VerifiedPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const session = await getServerSession();
  const verified = !!session?.user.emailVerified;

  // A bad or old link, or a signed-in person who still has to confirm.
  if (!verified && (error || session)) {
    return (
      <AuthShell>
        <h1>{error ? "Let’s try a new link" : "Confirm your email"}</h1>
        <p className="sub">
          {error ? errorText(error.slice(0, 40)) : `We sent a link to ${session!.user.email}. Open it on any device to confirm.`}
        </p>
        {session ? (
          <>
            <p className="fine" style={{ marginBottom: 16 }}>
              We’ll send it to <b>{session.user.email}</b>.
            </p>
            <ResendVerification label="Send a new link" className="btn btn-dark btn-lg" />
          </>
        ) : (
          <>
            <p className="fine" style={{ marginBottom: 16 }}>Log in and you can send yourself a new link from your account page.</p>
            <Link href="/login?next=%2Faccount" className="btn btn-dark btn-lg btn-block">
              Log in
            </Link>
          </>
        )}
        <p className="switch-line">
          Need help? <a href="mailto:contact@conuron.com">contact@conuron.com</a>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <span className="done-badge" aria-hidden>
        ✓
      </span>
      <h1>Your email is confirmed</h1>
      <p className="sub">
        Thanks! You can go back to the oovi app now: your free theOovi credits are ready to use.
      </p>
      <div className="stack-actions">
        <Link href="/account" className="btn btn-dark btn-lg">
          Go to your account
        </Link>
        <Link href="/download" className="btn btn-light btn-lg">
          Download oovi
        </Link>
      </div>
    </AuthShell>
  );
}
