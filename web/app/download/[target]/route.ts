import { NextResponse } from "next/server";
import { isDownloadTarget, resolveDownloadUrl } from "@/lib/releases";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ target: string }> }) {
  const { target } = await params;
  const fallback = new URL("/download?error=unavailable", req.url);
  if (!isDownloadTarget(target)) return NextResponse.redirect(fallback, 302);
  const url = await resolveDownloadUrl(target);
  if (!url) return NextResponse.redirect(fallback, 302);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}
