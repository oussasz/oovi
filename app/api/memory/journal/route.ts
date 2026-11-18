// Memory's change log (lib/memory.ts): GET the latest changes (newest first), POST {id} undoes one.
import { guard } from "@/lib/guard";
import { readJournal, undoChange } from "@/lib/memory";
import { listBots } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const bots = new Map(listBots().map((b) => [b.id, b.name]));
  return Response.json({ changes: readJournal().slice(-60).reverse().map((e) => ({ ...e, bot: e.botId ? bots.get(e.botId) ?? null : null })) });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const err = undoChange(String(b?.id ?? ""));
  return err ? Response.json({ error: err }, { status: 409 }) : Response.json({ ok: true });
}
