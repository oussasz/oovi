import { guard } from "@/lib/guard";
import { getBot } from "@/lib/store";
import { mainBot, pinMainBot } from "@/lib/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The user's main bot: it runs the groups and answers on Telegram. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = mainBot();
  return Response.json({ botId: b?.id ?? null, name: b?.name ?? null });
}

/** {botId} makes that bot the main bot. */
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { botId?: unknown } | null;
  const id = typeof body?.botId === "string" ? body.botId : "";
  if (!getBot(id)) return Response.json({ error: "Bot not found." }, { status: 404 });
  pinMainBot(id);
  return Response.json({ botId: id, name: getBot(id)?.name ?? null });
}
