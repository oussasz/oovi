import { guard } from "@/lib/guard";
import { isRunning } from "@/lib/runner";
import { createGroup, listBots, listChats, summarize, validateGroup } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All chats (groups and 1:1), most recent first. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const bots = listBots();
  const chats = listChats()
    .map((c) => summarize(c, bots, isRunning(c.id)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return Response.json(chats);
}

/** Create a group. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const g = validateGroup(await req.json().catch(() => null));
  if (typeof g === "string") return Response.json({ error: g }, { status: 400 });
  return Response.json(createGroup(g), { status: 201 });
}
