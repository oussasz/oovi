// The app says the person saw, opened or closed an announcement: {kind}. Closed = never shown again, on
// any of their computers.
import { apiError, getRequestSession, noContent, rateLimit, readJson } from "@/lib/api";
import { EVENT_KINDS, recordEvent } from "@/lib/announcements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`ann:ev:${session.user.id}`, 60, 60 * 60_000)) return noContent();
  const { id } = await ctx.params;
  const b = await readJson(req, 1024);
  const kind = EVENT_KINDS.find((k) => k === b?.kind);
  if (!kind) return apiError("Unknown event.", 400);
  await recordEvent(id, session.user.id, kind).catch(() => {});
  return noContent();
}
