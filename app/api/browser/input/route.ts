import { liveTarget, parseInput, sendInput, type LiveInput } from "@/lib/browser-live";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 128 * 1024;
const MAX_BATCH = 20;

/**
 * POST {chat, bot, event} or {chat, bot, events: [...]} (at most 20, run in order):
 * mouse, wheel, key or text input for a bot's browser. Only while the user has control.
 * Never logged: this carries what the user types.
 */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "Too much input at once." }, { status: 413 });
  type Body = { chat?: unknown; bot?: unknown; event?: unknown; events?: unknown };
  const body = ((): Body | null => {
    try {
      const j: unknown = JSON.parse(raw);
      return j && typeof j === "object" ? (j as Body) : null;
    } catch {
      return null;
    }
  })();
  const target = liveTarget(body?.chat, body?.bot);
  if (target instanceof Response) return target;
  const list = Array.isArray(body?.events) ? body.events : body?.event !== undefined ? [body.event] : [];
  if (!list.length || list.length > MAX_BATCH) return Response.json({ error: `Send 1 to ${MAX_BATCH} events.` }, { status: 400 });
  const events: LiveInput[] = [];
  for (const e of list) {
    const ev = parseInput(e);
    if (!ev) return Response.json({ error: "Invalid input event." }, { status: 400 });
    events.push(ev);
  }
  const r = await sendInput(target.sessionId, events);
  return r.ok ? new Response(null, { status: 204 }) : Response.json({ error: r.error }, { status: r.status });
}
