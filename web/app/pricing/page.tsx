import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getAiConfig, getPilotConfig, getPlans } from "@/lib/ai-config";
import { paddleClientConfig, type PaddleClientConfig } from "@/lib/paddle-config";
import { TIERS } from "@/lib/pricing-tiers";
import { getServerSession } from "@/lib/session";
import { PaddlePricing, type PricedTier } from "./PaddlePricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "oovi is free with your own API key. theOovi, the built-in model, uses credits: start with free credits, or pick a plan for more.",
};
export const dynamic = "force-dynamic";

const fmt = (v: number) => new Intl.NumberFormat("en-US").format(v);
const dailyText = (v: number) => (v === 0 ? "No daily limit" : `Daily safety limit: ${fmt(v)} credits`);

/** Paddle settings, or why checkout is off. Never guessed: a missing or mismatched setting turns checkout off and is logged. */
function checkoutConfig(): { config: PaddleClientConfig } | { error: string } {
  try {
    return { config: paddleClientConfig() };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[pricing] Paddle checkout is off: ${error}`);
    return { error };
  }
}

export default async function PricingPage() {
  const [cfg, plans, pilot, session, h] = await Promise.all([getAiConfig(), getPlans(), getPilotConfig(), getServerSession(), headers()]);
  const free = plans.find((p) => p.id === "free");
  const name = cfg.displayName;
  const checkout = checkoutConfig();
  // Vercel's guess of the visitor's country. Without it, Paddle works the country out from the IP itself.
  const ipCountry = h.get("x-vercel-ip-country")?.toUpperCase();
  const country = ipCountry && /^[A-Z]{2}$/.test(ipCountry) && ipCountry !== "XX" ? ipCountry : undefined;
  // Credits and daily limit from Admin > theOovi plans, when a plan with the tier's planId exists.
  const tiers: PricedTier[] = TIERS.map((t) => {
    const plan = t.planId ? plans.find((p) => p.id === t.planId) : undefined;
    const extras = plan ? [...(plan.monthlyCredits > 0 ? [`${fmt(plan.monthlyCredits)} credits every month`] : []), dailyText(plan.dailyLimit)] : [];
    return { ...t, extras };
  });

  const freeCard = (
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
  );
  const ownCard = (
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
  );

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

        {"error" in checkout && (
          <p className="alert alert-error" role="status">
            Online checkout isn’t available right now. Write to contact@conuron.com to subscribe.
          </p>
        )}
        {"config" in checkout ? (
          <PaddlePricing
            config={checkout.config}
            tiers={tiers}
            country={country}
            email={session?.user.email}
            userId={session?.user.id}
            leading={freeCard}
            trailing={ownCard}
          />
        ) : (
          <div className="price-grid">
            {freeCard}
            {ownCard}
          </div>
        )}

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
