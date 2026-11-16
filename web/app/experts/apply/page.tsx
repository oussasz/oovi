import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { CONSENT_TEXT, CONSENT_VERSION, LIMITS } from "@/lib/expert-form";
import { ExpertForm } from "./ExpertForm";

export const metadata: Metadata = {
  title: "Become an expert on oovi",
  description: "Ask to be added as an expert on oovi: an assistant that shares your know-how in the Marketplace.",
};

export default function ExpertApplyPage() {
  return (
    <>
      <SiteNav />
      <main className="container page page-narrow">
        <div className="page-head">
          <span className="tag">
            <span className="tag-dot" style={{ background: "#B7A8FF" }} /> Experts
          </span>
          <h1 className="h2">Become an expert on oovi.</h1>
          <p className="muted">
            Do you have know-how people ask you about every day? An oovi expert is an assistant that works the way you do, like the startup coach you can find in the Marketplace.
            Tell us about you. This is a request: we read every one, and nothing is published until we have agreed the details with you in writing.
          </p>
        </div>
        <section className="card">
          <ExpertForm config={{ version: CONSENT_VERSION, text: CONSENT_TEXT, limits: LIMITS }} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
