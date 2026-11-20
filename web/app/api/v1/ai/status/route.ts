// What the app shows next to theOovi: credits, today's limit, plan, pilot and links.
import { getAiConfig } from "@/lib/ai-config";
import { supportsComputerToolset, CACHE_1H } from "@/lib/ai-tools";
import { apiError, clientIp, getRequestSession, json } from "@/lib/api";
import { creditStatus, isBlocked } from "@/lib/credits";
import { billingFor } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  if (await isBlocked(session.user.id)) return json({ error: "This account has been blocked. Contact contact@conuron.com.", code: "blocked" }, 403);
  try {
    const [status, cfg, billing] = await Promise.all([
      creditStatus(session.user.id, session.user.createdAt, clientIp(req), !!session.user.emailVerified),
      getAiConfig(),
      billingFor(session.user.id).catch(() => null),
    ]);
    // desktop: the hosted model can use Anthropic's computer toolset (the app offers desktop control only then).
    // billing.inApp: apps pay through POST /api/v1/billing/link (no website sign-in); subscriber: a Paddle
    // subscription to manage (the app shows "Manage subscription"). links.subscribe/pricing stay for older apps:
    // /pricing needs no sign-in (it says to subscribe from the app).
    return json({
      ...status,
      desktop: supportsComputerToolset(cfg.model) || (!!cfg.backupModel && supportsComputerToolset(cfg.backupModel)),
      billing: { inApp: true, subscriber: !!billing && billing.subscriptionIds.length > 0 },
      // The app may mark the shared part of a request to be cached for one hour (lib/ai-tools.ts CACHE_1H).
      cache1h: CACHE_1H(),
    });
  } catch (err) {
    console.error("credit status failed", err instanceof Error ? err.message : err);
    return apiError("Couldn't load your credits. Please try again.", 503);
  }
}
