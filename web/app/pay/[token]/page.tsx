// The page a payment link from the app opens (POST /api/v1/billing/link). No sign-in: the link itself, used once
// within 10 minutes, says which account pays. Checkout: the plans, with Paddle's checkout for exactly that account
// (its id in customData, its email prefilled); a plan chosen in the app opens by itself. Portal: straight to that
// account's Paddle customer portal. Nothing else about the account is shown.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PaddlePricing, type PricedTier } from "../../pricing/PaddlePricing";
import { getPlans } from "@/lib/ai-config";
import { billingFor } from "@/lib/billing";
import { PAY_TEXT, payLang } from "@/lib/pay-core";
import { consumePayLink } from "@/lib/pay-links";
import { paddleClientConfig } from "@/lib/paddle-config";
import { paddleApi } from "@/lib/paddle-server";
import { TIERS } from "@/lib/pricing-tiers";
import { PayMessage } from "../PayMessage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "oovi", robots: { index: false, follow: false }, referrer: "no-referrer" };

const fmt = (v: number) => new Intl.NumberFormat("en-US").format(v);

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const h = await headers();
  const lang = payLang(h.get("accept-language"));
  const T = PAY_TEXT[lang];
  const { token } = await params;
  const link = await consumePayLink(token).catch(() => null);
  if (!link) return <PayMessage lang={lang} title={T.goneTitle} text={T.gone} />;

  if (link.kind === "portal") {
    const billing = await billingFor(link.userId).catch(() => null);
    if (!billing) return <PayMessage lang={lang} title={T.noSubTitle} text={T.noSub} />;
    let url: string | null = null;
    try {
      const api = paddleApi();
      if (api) url = (await api.customerPortalSessions.create(billing.customerId, billing.subscriptionIds)).urls.general.overview;
      else console.error("[billing] pay portal: PADDLE_API_KEY is not set.");
    } catch (err) {
      console.error("[billing] pay portal failed:", err instanceof Error ? err.name : "error");
    }
    if (!url) return <PayMessage lang={lang} title={T.offTitle} text={T.off} />;
    redirect(url);
  }

  let config;
  try {
    config = paddleClientConfig();
  } catch (err) {
    console.error("[billing] pay checkout is off:", err instanceof Error ? err.message : err);
    return <PayMessage lang={lang} title={T.offTitle} text={T.off} />;
  }
  const plans = await getPlans();
  const tiers: PricedTier[] = TIERS.map((t) => {
    const plan = t.planId ? plans.find((p) => p.id === t.planId) : undefined;
    const extras = plan ? [...(plan.monthlyCredits > 0 ? [`${fmt(plan.monthlyCredits)} credits every month`] : []), plan.dailyLimit === 0 ? "No daily limit" : `Daily safety limit: ${fmt(plan.dailyLimit)} credits`] : [];
    return { ...t, extras };
  });
  const ipCountry = h.get("x-vercel-ip-country")?.toUpperCase();
  const country = ipCountry && /^[A-Z]{2}$/.test(ipCountry) && ipCountry !== "XX" ? ipCountry : undefined;
  const [before, after] = T.checkoutLead.split("{email}");
  return (
    <main className="container page pay-page">
      <div className="page-head" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
        <h1 className="h2">{T.checkoutTitle}</h1>
        <p className="lead">
          {before}
          <b dir="ltr">{link.email}</b>
          {after}
        </p>
      </div>
      <PaddlePricing config={config} tiers={tiers} country={country} email={link.email} userId={link.userId} autoOpenPriceId={link.priceId} successPath="/pay/done" />
    </main>
  );
}
