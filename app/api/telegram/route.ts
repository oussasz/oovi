import { guard } from "@/lib/guard";
import { connect, disconnect, dismissDetected, removeLink, saveLink, sendTest, startTelegram, status } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Telegram link status for Settings. Also makes sure the listener runs. ?advanced=1 also lists the groups chats can be linked to. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  startTelegram();
  const advanced = new URL(req.url).searchParams.get("advanced") === "1";
  return Response.json(status({ groups: advanced }));
}

/**
 * {token} saves a bot token from @BotFather; {action:"test"} sends a test message.
 * Advanced: {action:"link", chatId, groupId, label, previousChatId?} links a Telegram chat to a group
 * (or edits a link), {action:"unlink", chatId} removes it, {action:"dismiss", chatId} forgets a detected chat.
 */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { token?: unknown; action?: unknown; chatId?: unknown; groupId?: unknown; label?: unknown; previousChatId?: unknown } | null;
  try {
    if (body?.action === "test") {
      await sendTest();
      return Response.json(status());
    }
    if (body?.action === "link") return Response.json(saveLink({ chatId: body.chatId, groupId: body.groupId, label: body.label, previousChatId: body.previousChatId }));
    if (body?.action === "unlink") return Response.json(removeLink(body.chatId));
    if (body?.action === "dismiss") return Response.json(dismissDetected(body.chatId));
    if (typeof body?.token === "string") return Response.json(await connect(body.token));
    return Response.json({ error: "Send {token} or {action: 'test'}." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(disconnect());
}
