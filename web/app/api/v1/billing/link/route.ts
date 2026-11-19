// The app's Subscribe / Manage subscription buttons: a single-use payment link for the signed-in account
// (Bearer token from the desktop app, or the phone app's session). The browser opens it; no website sign-in.
// {kind:"checkout", plan?, cycle?, priceId?} or {kind:"portal"} → {url} (https://<site>/pay/<token>, 10 minutes, once).
import { apiError, getRequestSession, json, rateLimit, readJson } from "@/lib/api";
import { billingFor } from "@/lib/billing";
import { isBlocked } from "@/lib/credits";
import { checkLinkRequest } from "@/lib/pay-core";
import { createPayLink } from "@/lib/pay-links";
import { TIERS } from "@/lib/pricing-tiers";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Plan id → its Paddle prices (only what the site sells). */
const PRICES = Object.fromEntries(TIERS.filter((t) => t.planId).map((t) => [t.planId!, t.priceId]));

export async function POST(req: Request) {
  // With the session cookie (phone app), only from the site itself.
  const origin = req.headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      /* "null" or garbage */
    }
    if (host !== new URL(req.url).host && host !== new URL(siteUrl()).host) return apiError("Not allowed from another website.", 403);
  }
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in to oovi first.", 401);
  const userId = session.user.id;
  if (!rateLimit(`paylink:${userId}`, 20, 10 * 60_000)) return apiError("Too many requests. Try again in a few minutes.", 429);
  if (await isBlocked(userId)) return json({ error: "This account has been blocked. Contact contact@conuron.com.", code: "blocked" }, 403);
  const body = await readJson(req, 4096);
  const v = checkLinkRequest(body, PRICES);
  if (typeof v === "string") return apiError(v, 400);
  try {
    if (v.kind === "portal" && !(await billingFor(userId))) {
      return json({ error: "This account has no subscription to manage yet.", code: "no_subscription" }, 404);
    }
    const token = await createPayLink(userId, v.kind, v.kind === "checkout" ? v.priceId : null);
    if (token === "too_many") return apiError("Too many payment links. Wait a few minutes and try again.", 429);
    return json({ url: `${siteUrl()}/pay/${token}`, expiresIn: 600 });
  } catch (err) {
    console.error("[billing] pay link failed:", err instanceof Error ? err.name : "error");
    return apiError("Payments aren't available right now. Try again in a minute.", 503);
  }
}
