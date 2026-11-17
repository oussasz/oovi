import { guard } from "@/lib/guard";
import { forScreens } from "@/lib/experts-core";
import { createBot, listBots, validateBot } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(listBots().map(forScreens));
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const input = validateBot(await req.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  return Response.json(forScreens(createBot(input)), { status: 201 });
}
