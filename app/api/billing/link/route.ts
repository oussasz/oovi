// "Subscribe" and "Manage subscription": asks oovi's website for a single-use payment link tied to this computer's
// signed-in account (10 minutes, once). The screen opens it in the person's normal browser; no website sign-in.
// Body: {kind: "checkout", plan?, cycle?} or {kind: "portal"} → {url}.
import { guard } from "@/lib/guard";
import { cloud, cloudUrl, CloudError } from "@/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const kind = body.kind === "portal" ? "portal" : body.kind === "checkout" ? "checkout" : null;
  if (!kind) return Response.json({ error: "Invalid request." }, { status: 400 });
  const send: Record<string, unknown> = { kind };
  if (kind === "checkout" && typeof body.plan === "string") send.plan = body.plan.slice(0, 40);
  if (kind === "checkout" && (body.cycle === "month" || body.cycle === "year")) send.cycle = body.cycle;
  try {
    const r = await cloud<{ url?: unknown; code?: string }>("/api/v1/billing/link", { method: "POST", body: send, auth: true });
    // Only ever open oovi's own payment page.
    if (typeof r?.url !== "string" || !r.url.startsWith(`${cloudUrl()}/pay/`)) return Response.json({ error: "The payment page couldn't be opened. Try again." }, { status: 502 });
    return Response.json({ url: r.url }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof CloudError ? e.status : 0;
    const msg = e instanceof Error ? e.message : "The payment page couldn't be opened. Try again.";
    return Response.json({ error: msg, code: status === 404 && kind === "portal" ? "no_subscription" : undefined }, { status: status >= 400 ? status : 502 });
  }
}
