import { NextResponse, after } from "next/server";
import { isDownloadTarget, resolveDownloadUrl } from "@/lib/releases";
import { countryFromHeaders, looksLikeBot, recordDownload } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ target: string }> }) {
  const { target } = await params;
  const fallback = new URL("/download?error=unavailable", req.url);
  if (!isDownloadTarget(target)) return NextResponse.redirect(fallback, 302);
  const url = await resolveDownloadUrl(target);
  if (!url) return NextResponse.redirect(fallback, 302);
  // Count the download after the redirect is sent (Vercel keeps the function alive
  // for `after`). Only the platform and country are stored, never the IP address.
  // recordDownload has its own timeout and never throws.
  if (!looksLikeBot(req.headers)) {
    const country = countryFromHeaders(req.headers);
    after(() => recordDownload(target, country));
  }
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}
