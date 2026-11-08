import { closeSession } from "@/lib/browser";
import { guard } from "@/lib/guard";
import { stopRun } from "@/lib/runner";
import { deleteBot, dmId, getBot, updateBot, validateBot } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const bot = getBot((await params).id);
  return bot ? Response.json(bot) : Response.json({ error: "Bot not found." }, { status: 404 });
}

export async function PUT(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  const input = validateBot(await req.json().catch(() => null), id);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const bot = updateBot(id, input);
  return bot ? Response.json(bot) : Response.json({ error: "Bot not found." }, { status: 404 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  stopRun(dmId(id));
  await closeSession(`${dmId(id)}_${id}`);
  deleteBot(id);
  return new Response(null, { status: 204 });
}
