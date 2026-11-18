// Runner only: read and save a chat of the account whose job it runs (same versions and answers as /chats).
import { isUserId } from "@/lib/cloud-core";
import { chatGet, chatPut } from "@/lib/cloud-handlers";
import { fail, guarded, runnerOnly } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ userId: string; chatId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const { userId, chatId } = await params;
  if (!isUserId(userId)) return fail(400, "bad_request", "Invalid account id.");
  return guarded("runner.chats.get", () => chatGet(userId, chatId));
}

export async function PUT(req: Request, { params }: Ctx) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const { userId, chatId } = await params;
  if (!isUserId(userId)) return fail(400, "bad_request", "Invalid account id.");
  return guarded("runner.chats.put", () => chatPut(req, userId, chatId));
}
