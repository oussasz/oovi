// A copy of a chat up to one of its messages ({entryId}), to try another direction: the original stays as it
// is. The copy keeps the chat's work files (tables, notes) as they are now.
import fs from "node:fs";
import path from "node:path";
import { forkChat } from "@/lib/chat-basics-core";
import { dataDir } from "@/lib/settings";
import { guard } from "@/lib/guard";
import { getChat, listBots, newId, saveChat } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const chat = getChat((await params).id);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  if (chat.routine) return Response.json({ error: "A routine's chat can't be copied." }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { entryId?: unknown } | null;
  const base = chat.kind === "direct" ? (listBots().find((x) => x.id === chat.memberIds[0])?.name ?? "Chat") : chat.name || "Chat";
  const copy = forkChat(chat, String(b?.entryId ?? ""), newId(), Date.now(), `${base.replace(/ · copy( \d+)?$/, "")} · copy`);
  if (typeof copy === "string") return Response.json({ error: copy }, { status: 404 });
  saveChat(copy);
  const work = path.join(dataDir(), "work", `${chat.id}.json`);
  try {
    if (fs.existsSync(work)) fs.copyFileSync(work, path.join(dataDir(), "work", `${copy.id}.json`));
  } catch {
    /* the copy works without them */
  }
  return Response.json({ id: copy.id }, { status: 201 });
}
