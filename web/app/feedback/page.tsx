import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getServerSession } from "@/lib/session";
import { FeedbackForm } from "./FeedbackForm";

export const metadata: Metadata = { title: "Send feedback" };
export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/feedback");
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
          <FeedbackForm />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
