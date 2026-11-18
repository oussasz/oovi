// "Yes, it's my account" on the page shown when a sign-in came back to another browser. The hold token in the form
// is the proof (only that page has it); no session needed. Then: "Go back to the oovi app".
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/api";
import { holdPageHtml, logCode, pickLang, sameOrigin } from "@/lib/cloud-core";
import { confirmHeld } from "@/lib/cloud-oauth";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  "x-frame-options": "DENY",
};

export async function POST(req: Request) {
  const lang = pickLang(req.headers.get("accept-language"));
  const page = (step: "done" | "gone", service?: string, status = 200) => new NextResponse(holdPageHtml({ lang, step, service }), { status, headers: HEADERS });
  if (!sameOrigin("POST", req.headers.get("origin"), [new URL(req.url).host, new URL(siteUrl()).host])) return page("gone", undefined, 403);
  if (!rateLimit(`cloud:oauth-confirm:${clientIp(req)}`, 30, 10 * 60_000)) return page("gone", undefined, 429);
  try {
    const form = new URLSearchParams((await req.text()).slice(0, 1000));
    const r = await confirmHeld(form.get("hold") ?? "");
    return r ? page("done", r.service) : page("gone", undefined, 410);
  } catch (err) {
    console.error("cloud connectors.oauth.confirm failed:", logCode(err));
    return page("gone", undefined, 503);
  }
}
