// One-click unsubscribe from oovi news (the List-Unsubscribe header of announcement emails): mail apps POST
// here. A GET (someone opening the link) goes to the page that asks to confirm.
import { readUnsubToken, setNewsOptOut } from "@/lib/announcements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = readUnsubToken(new URL(req.url).searchParams.get("t") ?? "");
  if (!userId) return new Response("Invalid link", { status: 400 });
  await setNewsOptOut(userId, true);
  return new Response("Unsubscribed", { status: 200 });
}

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  return Response.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(t)}`, req.url), 303);
}
