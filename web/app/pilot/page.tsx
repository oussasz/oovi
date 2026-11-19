import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getAiConfig, getPilotConfig, pilotOpenFor, planById } from "@/lib/ai-config";
import { pool } from "@/lib/db";
import { userFor } from "@/lib/app-link-user";
import { PilotForm } from "./PilotForm";

export async function generateMetadata(): Promise<Metadata> {
  const pilot = await getPilotConfig();
  return {
    title: "Pilot program",
    description: "People who join oovi during the pilot can ask for free credits for theOovi in exchange for feedback.",
    // Invite-only unless listed publicly in the console: keep it out of search engines.
    ...(pilot.public ? {} : { robots: { index: false, follow: false } }),
  };
}
export const dynamic = "force-dynamic";

const fmt = (v: number) => new Intl.NumberFormat("en-US").format(v);
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
const fmtDate = (d: string | Date) => dateFmt.format(typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d);

type Existing = { status: "pending" | "approved" | "rejected"; credits: number | null; created_at: Date };

// Opened from the app with a single-use link (?t=…, lib/app-links.ts): the website has no sign-in any more.
export default async function PilotPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t: token } = await searchParams;
  const [user, cfg, ai] = await Promise.all([userFor(token, "pilot"), getPilotConfig(), getAiConfig()]);
  const session = user ? { user } : null;
  const plan = await planById(cfg.plan);
  const name = ai.displayName;
  let existing: Existing | null = null;
  if (session?.user) {
    try {
      const { rows } = await pool.query<Existing>("SELECT status, credits, created_at FROM pilot_requests WHERE user_id = $1", [session.user.id]);
      existing = rows[0] ?? null;
    } catch (err) {
      console.error("pilot status failed", err instanceof Error ? err.message : err);
    }
  }
  const win = session?.user ? pilotOpenFor(cfg, session.user.createdAt) : pilotOpenFor(cfg, new Date());

  let body: React.ReactNode;
  if (!session?.user) {
    body = (
      <>
        <h2>Ask from the oovi app</h2>
        <p className="muted">
          Open oovi, sign in with an account created during the pilot period, then go to Settings and tap “Join the pilot”. It opens this
          page for your account. {token ? "This link has expired or was already used: ask for a new one from the app." : ""}
        </p>
        <div className="row-actions" style={{ marginTop: 16 }}>
          <Link href="/download" className="btn btn-dark btn-md">
            Download oovi
          </Link>
        </div>
      </>
    );
  } else if (existing) {
    body =
      existing.status === "approved" ? (
        <>
          <h2>You’re in the pilot</h2>
          <p className="alert alert-ok" role="status">
            Your request was approved{existing.credits ? `: ${fmt(existing.credits)} credits were added to your account` : ""}. Thank you for
            helping us improve oovi.
          </p>
          <div className="row-actions" style={{ marginTop: 16 }}>
            <Link href="/download" className="btn btn-light btn-md">
              Open oovi
            </Link>
          </div>
        </>
      ) : existing.status === "rejected" ? (
        <>
          <h2>Your request wasn’t approved</h2>
          <p className="muted">
            Thanks for your interest. We couldn’t include your request in this round of the pilot. You can still use your welcome credits,
            pick a plan, or use your own API key for free.
          </p>
          <div className="row-actions" style={{ marginTop: 16 }}>
            <Link href="/pricing" className="btn btn-light btn-md">
              See pricing
            </Link>
          </div>
        </>
      ) : (
        <>
          <h2>
            <span aria-hidden="true">🎉 </span>Thank you! Your request is in
          </h2>
          <p className="muted">You sent it on {fmtDate(existing.created_at)}. We read every request by hand.</p>
          <ol className="steps-list" style={{ marginTop: 14 }}>
            <li>
              <b>We review it</b> by hand.
            </li>
            <li>
              <b>When it’s approved,</b> an email tells you and the credits appear in your account and in the app.
            </li>
            <li>
              <b>While you wait,</b> keep trying oovi, and tell us what you notice with “Send feedback” in the app.
            </li>
          </ol>
        </>
      );
  } else if (!win.open) {
    body = (
      <>
        <h2>The pilot isn’t open right now</h2>
        <p className="muted">
          {cfg.enabled
            ? `The pilot runs from ${fmtDate(cfg.startsAt)} to ${fmtDate(cfg.endsAt)}.`
            : "We’re not accepting new requests at the moment."}{" "}
          You can still use your welcome credits, pick a plan, or use your own API key for free.
        </p>
        <div className="row-actions" style={{ marginTop: 16 }}>
          <Link href="/pricing" className="btn btn-light btn-md">
            See pricing
          </Link>
        </div>
      </>
    );
  } else if (!win.eligible) {
    body = (
      <>
        <h2>This account isn’t eligible</h2>
        <p className="muted">
          The pilot is for accounts created between {fmtDate(cfg.startsAt)} and {fmtDate(cfg.endsAt)}. Your account was created on{" "}
          {fmtDate(new Date(session.user.createdAt))}, so it can’t join this pilot. You can still use your welcome credits, pick a plan, or
          use your own API key for free.
        </p>
        <div className="row-actions" style={{ marginTop: 16 }}>
          <Link href="/pricing" className="btn btn-light btn-md">
            See pricing
          </Link>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h2>Ask to join</h2>
        <p className="muted" style={{ marginBottom: 18 }}>
          Signed in as {session.user.email}. Four quick steps, mostly taps. It helps us build what you need.
        </p>
        <PilotForm token={user && token ? token : undefined} />
      </>
    );
  }

  return (
    <>
      <SiteNav />
      <main className="container page pilot-page">
        <div className="page-head">
          <h1 className="h2">{fmt(cfg.credits)} free credits for early users.</h1>
          <p className="lead">
            If you created your oovi account during the pilot, you can ask for {fmt(cfg.credits)} credits for {name}. In exchange, tell us
            what works, what doesn’t, and what you’d like to see.
          </p>
        </div>

        <div className="pilot-grid">
          <section className="card" aria-labelledby="pilot-how">
            <h2 id="pilot-how">How it works</h2>
            <ol className="steps-list">
              <li>
                <b>Who can apply:</b> accounts created between {fmtDate(cfg.startsAt)} and {fmtDate(cfg.endsAt)}.
              </li>
              <li>
                <b>Tell us about your work:</b> a short form, all taps and stars, about a minute.
              </li>
              <li>
                <b>We review each request</b> by hand.
              </li>
              <li>
                <b>Once approved:</b> {fmt(cfg.credits)} credits are added to your account
                {plan.id !== "free" ? `, and you get the ${plan.name} plan for ${fmt(cfg.days)} days` : ""}
                {plan.dailyLimit > 0 ? ` (up to ${fmt(plan.dailyLimit)} credits a day, reset at 00:00 UTC)` : ""}.
              </li>
              <li>
                <b>Send us feedback</b> about problems and improvements, from the app (“Send feedback”).
              </li>
            </ol>
          </section>

          <section className="card">{body}</section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
