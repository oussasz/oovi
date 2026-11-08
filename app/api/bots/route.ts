import { guard } from "@/lib/guard";
import { createBot, listBots, validateBot } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(listBots());
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const input = validateBot(await req.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  return Response.json(createBot(input), { status: 201 });
}
