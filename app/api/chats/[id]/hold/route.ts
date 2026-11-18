// Cancel a send that is waiting its few seconds ({callId}): lib/hold.ts.
import { guard } from "@/lib/guard";
import { cancelHold } from "@/lib/hold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => null)) as { callId?: unknown } | null;
  const ok = cancelHold((await params).id, String(b?.callId ?? ""));
  return ok ? Response.json({ ok: true }) : Response.json({ error: "It was already sent." }, { status: 409 });
}
