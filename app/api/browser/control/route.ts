import { peekSession } from "@/lib/browser";
import { liveInfo, liveTarget, releaseControl, takeControl } from "@/lib/browser-live";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {chat, bot, action: "take" | "release"}: the user takes over a bot's browser, or hands it back. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { chat?: unknown; bot?: unknown; action?: unknown } | null;
  const target = liveTarget(body?.chat, body?.bot);
  if (target instanceof Response) return target;
  const { sessionId } = target;
  if (body?.action === "take") {
    if (!takeControl(sessionId)) return Response.json({ error: "The bot's browser is closed." }, { status: 404 });
  } else if (body?.action === "release") {
    if (!peekSession(sessionId)) return Response.json({ error: "The bot's browser is closed." }, { status: 404 });
    releaseControl(sessionId);
  } else {
    return Response.json({ error: "action must be take or release." }, { status: 400 });
  }
  return Response.json(liveInfo(sessionId));
}
