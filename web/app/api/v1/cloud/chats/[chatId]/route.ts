// One synced chat: read, save with a version (409 = merge and send again), delete (a 30-day tombstone).
import { deleteChat } from "@/lib/cloud";
import { isId } from "@/lib/cloud-core";
import { chatGet, chatPut } from "@/lib/cloud-handlers";
import { fail, guarded, notFound, ok, signedIn, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ chatId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const who = await signedIn(req, "read");
  if (!("userId" in who)) return who;
  const { chatId } = await params;
  return guarded("chats.get", () => chatGet(who.userId, chatId));
}

export async function PUT(req: Request, { params }: Ctx) {
  const who = await signedIn(req, "write");
  if (!("userId" in who)) return who;
  const { chatId } = await params;
  return guarded("chats.put", () => chatPut(req, who.userId, chatId));
}

export async function DELETE(req: Request, { params }: Ctx) {
  const who = await signedIn(req, "write");
  if (!("userId" in who)) return who;
  const { chatId } = await params;
  if (!isId(chatId)) return fail(400, "bad_request", "Invalid chat id.");
  return guarded("chats.delete", async () => {
    const r = await deleteChat(who.userId, chatId);
    if (r && "off" in r) return syncOff();
    if (!r) return notFound();
    return ok(r);
  });
}
