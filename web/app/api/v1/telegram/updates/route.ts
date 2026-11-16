// The app collects its Telegram messages (lib/telegram-relay.ts). ?after=<last id it handled>. Waits up
// to 20 s for something new. &device=<id of this computer>: one computer answers at a time. 404 = the relay is off for this account (the app reads Telegram directly).
import { apiError, getRequestSession } from "@/lib/api";
import { collect } from "@/lib/telegram-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  const after = Math.max(0, Math.floor(Number(new URL(req.url).searchParams.get("after")) || 0));
  const wait = Math.min(20_000, Math.max(0, Number(new URL(req.url).searchParams.get("wait")) || 20_000));
  const device = (new URL(req.url).searchParams.get("device") ?? "").replace(/[^\w-]/g, "").slice(0, 64) || "unknown";
  const updates = await collect(session.user.id, device, after, wait);
  if (!updates) return apiError("The Telegram relay is off.", 404);
  return Response.json({ updates }, { headers: { "cache-control": "no-store" } });
}
