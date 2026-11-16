// What the app shows the signed-in person now (lib/announcements.ts): the window and/or the top bar.
import { apiError, getRequestSession, rateLimit } from "@/lib/api";
import { activeFor } from "@/lib/announcements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`ann:${session.user.id}`, 60, 60 * 60_000)) return Response.json({ items: [] });
  try {
    return Response.json({ items: await activeFor(session.user.id, session.user.email) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("announcements read failed", err instanceof Error ? err.message : err);
    return Response.json({ items: [] });
  }
}
