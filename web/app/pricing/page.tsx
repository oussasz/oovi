import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getAiConfig, getPilotConfig, getPlans, type Plan } from "@/lib/ai-config";

export const metadata: Metadata = {
  title: "Pricing",
  description: "oovi is free with your own API key. theOovi, the built-in model, uses credits: start with free credits, or pick a plan for more.",
};
export const dynamic = "force-dynamic";

const fmt = (v: number) => new Intl.NumberFormat("en-US").format(v);
const dailyText = (v: number) => (v === 0 ? "No daily limit" : `Daily safety limit: ${fmt(v)} credits`);

function subscribeHref(url: string, plan: Plan): string {
  if (url) return url;
  return `mailto:contact@conuron.com?subject=${encodeURIComponent(`oovi ${plan.name} plan`)}`;
}

export default async function PricingPage() {
  const [cfg, plans, pilot] = await Promise.all([getAiConfig(), getPlans(), getPilotConfig()]);
  const free = plans.find((p) => p.id === "free");
  const paid = plans.filter((p) => p.visible && p.id !== "free");
  const name = cfg.displayName;

  return (
    <>
      <SiteNav />
      <main className="container page">
        <div className="page-head pricing-head">
          <span className="tag">
            <span className="tag-dot" style={{ background: "#FDDA80" }} /> Pricing
          </span>
          <h1 className="h2">Simple, fair pricing.</h1>
          <p className="lead">
            oovi itself is free. Use it with your own API key at no cost, or use {name}, our built-in model, with credits.
          </p>
          {(!cfg.enabled || cfg.paused) && (
            <p className="alert alert-error" role="status">
              {cfg.paused ? cfg.pausedMessage : `${name} isn’t available right now. Your own API keys always work.`}
            </p>
          )}
        </div>

        <div className="price-grid">
          <section className="card price-card" aria-labelledby="plan-free">
            <h2 id="plan-free">{free?.name ?? "Free"}</h2>
            <p className="price">$0</p>
            <ul className="price-list">
              <li>{cfg.signupCredits > 0 ? `${fmt(cfg.signupCredits)} welcome credits for ${name}, once` : `Try ${name} with free credits`}</li>
              <li>{dailyText(free?.dailyLimit ?? 0)}</li>
              <li>All oovi features</li>
            </ul>
            <Link href="/signup" className="btn btn-light btn-md">
              Create a free account
            </Link>
          </section>

          {paid.map((p) => (
            <section key={p.id} className="card price-card price-card-plan" aria-labelledby={`plan-${p.id}`}>
              <h2 id={`plan-${p.id}`}>{p.name}</h2>
              <p className="price">{p.price || "Contact us"}</p>
              <ul className="price-list">
                <li>{p.monthlyCredits > 0 ? `${fmt(p.monthlyCredits)} credits every month` : "Credits on request"}</li>
                <li>{dailyText(p.dailyLimit)}</li>
                <li>All oovi features</li>
              </ul>
              <a href={subscribeHref(cfg.subscribeUrl, p)} className="btn btn-dark btn-md" rel={cfg.subscribeUrl ? "noopener" : undefined}>
                Subscribe to {p.name}
              </a>
            </section>
          ))}

          <section className="card price-card price-card-own" aria-labelledby="plan-own">
            <h2 id="plan-own">Your own API key</h2>
            <p className="price">Always free</p>
            <ul className="price-list">
              <li>Add your own key in the app (Settings &gt; AI models)</li>
              <li>You pay your provider directly</li>
              <li>No credits and no daily limit from us</li>
            </ul>
            <Link href="/download" className="btn btn-light btn-md">
              Download oovi
            </Link>
          </section>
        </div>

        <section className="card pricing-explain" aria-labelledby="how-credits">
          <h2 id="how-credits">How credits work</h2>
          <div className="pricing-faq">
            <div>
              <h3>What is a credit?</h3>
              <p className="muted">
                Credits measure how much work {name} does for you. A short question uses a small fraction of a credit. Long
                conversations, big files and long answers use more.
              </p>
            </div>
            <div>
              <h3>What is the daily safety limit?</h3>
              <p className="muted">
                A generous cap that stops a runaway task from using up your credits. Most people never reach it. It resets every
                day at 00:00 UTC.
              </p>
            </div>
            <div>
              <h3>What happens to unused credits?</h3>
              <p className="muted">
                They stay in your balance. Monthly plan credits are added to what you already have. You can see your balance and
                today’s usage on your account page and in the app.
              </p>
            </div>
            {pilot.public && (
            <div>
              <h3>Is there a pilot program?</h3>
              <p className="muted">
                Yes. If you created your account during the pilot, you can ask for extra credits in exchange for feedback.{" "}
                <Link href="/pilot" className="text-link">
                  Learn about the pilot
                </Link>
              </p>
            </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
