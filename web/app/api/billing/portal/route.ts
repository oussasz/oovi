// "Manage billing" in the web app's Settings: opens the Paddle customer portal (payment method,
// invoices, cancel) for the signed-in account. The Paddle customer is looked up from the session
// on the server; nothing the browser sends decides whose portal opens.
import { billingFor } from "@/lib/billing";
import { paddleApi } from "@/lib/paddle-server";
import { getServerSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (req: Request, path: string) => Response.redirect(new URL(path, req.url), 303);
// Where Settings is: the web app (/app/settings) or the phone app (/m/settings); nothing else.
const SETTINGS = new Set(["/app/settings", "/m/settings"]);

export async function POST(req: Request) {
  // Same-site form posts only.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return new Response("Forbidden origin", { status: 403 });

  const form = await req.formData().catch(() => null);
  const from = String(form?.get("from") ?? "");
  const settings = SETTINGS.has(from) ? from : "/app/settings";

  const session = await getServerSession();
  if (!session) return back(req, `/login?next=${encodeURIComponent(settings)}`);

  const billing = await billingFor(session.user.id);
  if (!billing) return back(req, `${settings}?billing=none`);

  let api;
  try {
    api = paddleApi();
  } catch (err) {
    console.error("[billing] portal:", err instanceof Error ? err.message : err);
    return back(req, `${settings}?billing=unavailable`);
  }
  if (!api) {
    console.error("[billing] portal: PADDLE_API_KEY is not set.");
    return back(req, `${settings}?billing=unavailable`);
  }

  try {
    const portal = await api.customerPortalSessions.create(billing.customerId, billing.subscriptionIds);
    return Response.redirect(portal.urls.general.overview, 303);
  } catch (err) {
    console.error("[billing] portal session failed:", err instanceof Error ? err.message : err);
    return back(req, `${settings}?billing=unavailable`);
  }
}
