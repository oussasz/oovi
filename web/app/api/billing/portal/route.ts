// "Manage billing" on the account page: opens the Paddle customer portal (payment method,
// invoices, cancel) for the signed-in account. The Paddle customer is looked up from the session
// on the server; nothing the browser sends decides whose portal opens.
import { billingFor } from "@/lib/billing";
import { paddleApi } from "@/lib/paddle-server";
import { getServerSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (req: Request, path: string) => Response.redirect(new URL(path, req.url), 303);

export async function POST(req: Request) {
  // Same-site form posts only.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return new Response("Forbidden origin", { status: 403 });

  const session = await getServerSession();
  if (!session) return back(req, "/login?next=%2Faccount");

  const billing = await billingFor(session.user.id);
  if (!billing) return back(req, "/account?billing=none");

  let api;
  try {
    api = paddleApi();
  } catch (err) {
    console.error("[billing] portal:", err instanceof Error ? err.message : err);
    return back(req, "/account?billing=unavailable");
  }
  if (!api) {
    console.error("[billing] portal: PADDLE_API_KEY is not set.");
    return back(req, "/account?billing=unavailable");
  }

  try {
    const portal = await api.customerPortalSessions.create(billing.customerId, billing.subscriptionIds);
    return Response.redirect(portal.urls.general.overview, 303);
  } catch (err) {
    console.error("[billing] portal session failed:", err instanceof Error ? err.message : err);
    return back(req, "/account?billing=unavailable");
  }
}
