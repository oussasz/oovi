import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { getServerSession } from "@/lib/session";

export const metadata: Metadata = { title: "Welcome", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Where Paddle Checkout sends people after a successful payment. */
export default async function WelcomePage() {
  const session = await getServerSession();
  return (
    <AuthShell>
      <h1>Thank you for subscribing</h1>
      <p className="sub">
        Your payment went through. Paddle, our payment partner, has emailed your receipt{session ? ` to ${session.user.email}` : ""}.
      </p>
      <p className="fine" style={{ marginBottom: 16 }}>
        Your plan shows on your account page. If it isn’t there within a few minutes, write to contact@conuron.com and we’ll sort it out.
      </p>
      <Link href={session ? "/account" : "/login?next=%2Faccount"} className="btn btn-dark btn-lg btn-block">
        {session ? "Go to my account" : "Log in"}
      </Link>
    </AuthShell>
  );
}
