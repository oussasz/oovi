// The chat as a Markdown file to download (what was said and the files made; not the bots' inner steps).
import { chatMarkdown } from "@/lib/chat-basics-core";
import { guard } from "@/lib/guard";
import { getChat, listBots } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const chat = getChat((await params).id);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  const bots = listBots();
  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? "Bot";
  const title = chat.kind === "direct" && !chat.forkOf ? nameOf(chat.memberIds[0] ?? "") : chat.name || "Chat";
  const file = `${title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 40) || "chat"} ${new Date().toISOString().slice(0, 10)}.md`;
  return new Response(chatMarkdown(chat, title, nameOf), {
    headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="chat.md"; filename*=UTF-8''${encodeURIComponent(file)}` },
  });
}
