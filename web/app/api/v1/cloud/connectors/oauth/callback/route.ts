// The service sends the browser back here after a sign-in started on the phone (lib/cloud-oauth.ts).
// Same session as the start: tokens stored, then the phone's Connectors page (?connected=<id> or ?error=…).
// Another browser (an iPhone home-screen app opens the sign-in in Safari): a small page in the person's language
// shows the account (masked) and asks to confirm; the app then finishes it (POST /connectors/oauth/finish).
import { NextResponse } from "next/server";
import { clientIp, getRequestSession, rateLimit } from "@/lib/api";
import { connectorsReturn, holdPageHtml, logCode, pickLang } from "@/lib/cloud-core";
import { callbackCloudSignIn } from "@/lib/cloud-oauth";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
const back = (path: string) => NextResponse.redirect(new URL(path, siteUrl()), { status: 303, headers: NO_STORE });
const PAGE_HEADERS = {
  ...NO_STORE,
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-frame-options": "DENY",
};

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const session = await getRequestSession(req);
  if (!rateLimit(`cloud:oauth-cb:${session?.user.id ?? clientIp(req)}`, 30, 10 * 60_000)) return back(connectorsReturn(null, { error: "failed" }));
  try {
    const r = await callbackCloudSignIn(session?.user.id ?? null, session?.session.id ?? null, q.get("state") ?? "", q.get("code"), q.has("error"));
    if ("held" in r) {
      const html = holdPageHtml({ lang: pickLang(req.headers.get("accept-language")), step: "ask", service: r.service, email: r.email, otherAccount: r.otherAccount, holdToken: r.holdToken, action: "/api/v1/cloud/connectors/oauth/confirm" });
      return new NextResponse(html, { status: 200, headers: PAGE_HEADERS });
    }
    return back("error" in r ? connectorsReturn(r.connectorId, { error: r.error }) : connectorsReturn(r.connectorId, { ok: true }));
  } catch (err) {
    console.error("cloud connectors.oauth.callback failed:", logCode(err));
    return back(connectorsReturn(null, { error: "failed" }));
  }
}
