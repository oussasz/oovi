import { chatSessions } from "@/lib/browser-live";
import { guard } from "@/lib/guard";
import { getChat } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?chat=<id>: the bots in this chat that have a browser open (url, title, control state). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const chatId = new URL(req.url).searchParams.get("chat") ?? "";
  const chat = getChat(chatId);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  return Response.json(await chatSessions(chat.id, chat.memberIds), { headers: { "cache-control": "no-store" } });
}
