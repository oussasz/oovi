import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getServerSession } from "@/lib/session";
import { FeedbackForm } from "./FeedbackForm";

export const metadata: Metadata = { title: "Send feedback" };
export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const session = await getServerSession();
  return (
    <>
      <SiteNav />
      <main className="container page page-narrow">
        <div className="page-head">
          <span className="tag">
            <span className="tag-dot" style={{ background: "#FF9F86" }} /> Feedback
          </span>
          <h1 className="h2">Tell us what you think.</h1>
          <p className="muted">
            Found a problem or have an idea? Every message goes straight to the team. You can also send feedback from the app.
          </p>
        </div>
        <section className="card">
          {session ? (
            <FeedbackForm />
          ) : (
            // The website has no sign-in any more (owner, 2026-11-19): feedback is sent from the apps, signed in there.
            <>
              <h2>Send it from the oovi app</h2>
              <p className="muted">
                In the desktop app or the phone app, open Settings and tap “Send feedback”. It reaches us with your account, so we can answer.
                You can also write to <a href="mailto:contact@conuron.com">contact@conuron.com</a>.
              </p>
              <div className="row-actions" style={{ marginTop: 16 }}>
                <Link href="/download" className="btn btn-dark btn-md">
                  Download oovi
                </Link>
              </div>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
