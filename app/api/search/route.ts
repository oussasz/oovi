// Search every chat's messages (?q=words, ?chat=<id> for one chat only). Newest first.
import { searchChats } from "@/lib/chat-basics-core";
import { guard } from "@/lib/guard";
import { getChat, listBots, listChats } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const u = new URL(req.url).searchParams;
  const q = (u.get("q") ?? "").slice(0, 200);
  const one = u.get("chat");
  const bots = listBots();
  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? "Bot";
  const chats = one ? [getChat(one)].filter((c) => !!c) : listChats().filter((c) => !c.routine || c.entries.length);
  const titles = new Map(chats.map((c) => [c.id, c.kind === "direct" && !c.forkOf ? nameOf(c.memberIds[0] ?? "") : c.name || "Chat"]));
  const hits = searchChats(chats, q, nameOf, one ? 500 : 60);
  return Response.json({ hits: hits.map((h) => ({ ...h, chat: titles.get(h.chatId) ?? "" })) });
}
