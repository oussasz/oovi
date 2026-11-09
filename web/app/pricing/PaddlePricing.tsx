"use client";

// Paid plans: localized prices from Paddle.PricePreview, a monthly/yearly switch, and
// Subscribe buttons that open Paddle Checkout (one-page overlay) for the exact price shown.
// Prices are shown exactly as Paddle formats them; no price math happens here.
import { initializePaddle, type Paddle, type PricePreviewParams } from "@paddle/paddle-js";
import { useEffect, useState, type ReactNode } from "react";
import type { PaddleClientConfig } from "@/lib/paddle-config";
import type { Tier } from "@/lib/pricing-tiers";

type Cycle = "month" | "year";
export type PricedTier = Tier & { extras: string[] };

type Props = {
  config: PaddleClientConfig;
  tiers: PricedTier[];
  /** Two-letter country from the request, when known. Without it Paddle uses the visitor's IP. */
  country?: string;
  /** Signed-in customer, to prefill checkout. */
  email?: string;
  userId?: string;
  /** Cards shown before and after the paid plans, in the same grid. */
  leading?: ReactNode;
  trailing?: ReactNode;
};

export function PaddlePricing({ config, tiers, country, email, userId, leading, trailing }: Props) {
  const [cycle, setCycle] = useState<Cycle>("month");
  const [paddle, setPaddle] = useState<Paddle>();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    initializePaddle({
      token: config.token,
      environment: config.environment,
      // Checkout that can't open (e.g. the account isn't approved yet) would otherwise fail silently.
      eventCallback: (e) => {
        if (e.name === "checkout.error") setError("Checkout couldn’t open. Please try again later, or write to contact@conuron.com to subscribe.");
      },
    })
      .then((p) => {
        if (alive && p) setPaddle(p);
      })
      .catch(() => alive && setError("Checkout couldn’t load. Refresh the page to try again."));
    return () => {
      alive = false;
    };
  }, [config.token, config.environment]);

  // One request for every plan, monthly and yearly, so switching needs no new request.
  useEffect(() => {
    if (!paddle) return;
    let alive = true;
    const params: PricePreviewParams = {
      items: tiers.flatMap((t) => [t.priceId.month, t.priceId.year]).map((priceId) => ({ priceId, quantity: 1 })),
      ...(country ? { address: { countryCode: country } } : {}),
    };
    paddle
      .PricePreview(params)
      .then((res) => {
        if (!alive) return;
        const next: Record<string, string> = {};
        for (const item of res.data.details.lineItems) next[item.price.id] = item.formattedTotals.total;
        setPrices(next);
      })
      .catch(() => alive && setError("Prices couldn’t load. Refresh the page to try again."));
    return () => {
      alive = false;
    };
  }, [paddle, country, tiers]);

  function subscribe(tier: PricedTier) {
    if (!paddle) return;
    // Paid plans add credits to an oovi account, so the buyer signs in first.
    if (!userId) {
      window.location.href = "/login?next=%2Fpricing";
      return;
    }
    paddle.Checkout.open({
      items: [{ priceId: tier.priceId[cycle], quantity: 1 }],
      ...(email ? { customer: { email } } : {}),
      ...(userId ? { customData: { userId } } : {}),
      settings: { displayMode: "overlay", variant: "one-page", successUrl: `${window.location.origin}/welcome` },
    });
  }

  return (
    <>
      <div className="seg pricing-cycle" role="group" aria-label="Billing">
        <button type="button" className={cycle === "month" ? "on" : ""} aria-pressed={cycle === "month"} onClick={() => setCycle("month")}>
          Monthly
        </button>
        <button type="button" className={cycle === "year" ? "on" : ""} aria-pressed={cycle === "year"} onClick={() => setCycle("year")}>
          Yearly
        </button>
      </div>
      {error && (
        <p className="alert alert-error" role="status">
          {error}
        </p>
      )}
      <div className="price-grid">
        {leading}
        {tiers.map((tier) => {
          const price = prices[tier.priceId[cycle]];
          const id = `plan-${tier.name.toLowerCase()}`;
          return (
            <section key={tier.name} className={`card price-card price-card-plan${tier.featured ? " price-card-featured" : ""}`} aria-labelledby={id}>
              <h2 id={id}>{tier.name}</h2>
              <p className="price" aria-live="polite">
                {price ?? <span className="price-loading">…</span>}
                <span className="price-per"> / {cycle}</span>
              </p>
              <p className="muted">{tier.description}</p>
              <ul className="price-list">
                {[...tier.extras, ...tier.features].map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <button type="button" className="btn btn-dark btn-md" onClick={() => subscribe(tier)} disabled={!paddle || !price}>
                Subscribe to {tier.name}
              </button>
            </section>
          );
        })}
        {trailing}
      </div>
    </>
  );
}
