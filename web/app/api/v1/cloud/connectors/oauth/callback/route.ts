// The service sends the browser back here after a sign-in started on the phone. The tokens are stored sealed in
// the connector's vault entry; then the phone's Connectors page opens (?connected=<id> or ?error=…).
import { NextResponse } from "next/server";
import { getRequestSession, rateLimit } from "@/lib/api";
import { connectorsReturn, logCode } from "@/lib/cloud-core";
import { finishCloudSignIn } from "@/lib/cloud-oauth";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const back = (path: string) => NextResponse.redirect(new URL(path, siteUrl()), { status: 303, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const session = await getRequestSession(req);
  // Signed out (another browser, an expired session): the flow is left alone; the person signs in and tries again.
  if (!session) return back(connectorsReturn(null, { error: "signed_out" }));
  if (!rateLimit(`cloud:oauth-cb:${session.user.id}`, 30, 10 * 60_000)) return back(connectorsReturn(null, { error: "failed" }));
  try {
    const r = await finishCloudSignIn(session.user.id, session.session.id, q.get("state") ?? "", q.get("code"), q.has("error"));
    return back("error" in r ? connectorsReturn(r.connectorId, { error: r.error }) : connectorsReturn(r.connectorId, { ok: true }));
  } catch (err) {
    console.error("cloud connectors.oauth.callback failed:", logCode(err));
    return back(connectorsReturn(null, { error: "failed" }));
  }
}
