import { closeSession } from "@/lib/browser";
import { guard } from "@/lib/guard";
import { stopVm } from "@/lib/sandbox";
import { isRunning, stopRun, whenIdle } from "@/lib/runner";
import { groupAsksFor } from "@/lib/delegations";
import { deleteChat, dmId, getChat, listBots, saveChat, validateGroup } from "@/lib/store";
import { mainBot } from "@/lib/team";
import type { ChatWithState } from "@/lib/types";
import { validateWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Chat not found." }, { status: 404 });

export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const chat = getChat((await params).id);
  if (!chat) return notFound();
  const out: ChatWithState = { ...chat, running: isRunning(chat.id) };
  // In the main bot's chat: what the groups it gave tasks to are waiting on the user for.
  const main = mainBot(listBots());
  if (main && chat.id === dmId(main.id)) out.groupAsks = groupAsksFor(main.id);
  return Response.json(out);
}

/** Edit a group ({name, memberIds, leadId}), set any chat's project folder ({workspace: {path, autoEdit} | null}) or clear any chat ({clear: true}). */
export async function PUT(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const chat = getChat((await params).id);
  if (!chat) return notFound();
  if (isRunning(chat.id)) return Response.json({ error: "Wait for the bots to finish, or stop them first." }, { status: 409 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.clear === true) {
    chat.entries = [];
    chat.pending = undefined;
    await Promise.all(chat.memberIds.map((m) => closeSession(`${chat.id}_${m}`)));
    await stopVm(chat.id);
  } else if (body && "workspace" in body) {
    const ws = validateWorkspace(body.workspace);
    if (typeof ws === "string") return Response.json({ error: ws }, { status: 400 });
    if (ws) chat.workspace = ws;
    else delete chat.workspace;
  } else {
    if (chat.kind !== "group") return Response.json({ error: "Only groups can be edited here." }, { status: 400 });
    const g = validateGroup(body);
    if (typeof g === "string") return Response.json({ error: g }, { status: 400 });
    Object.assign(chat, g);
  }
  saveChat(chat);
  return Response.json({ ...chat, running: false });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const chat = getChat((await params).id);
  if (!chat) return notFound();
  stopRun(chat.id);
  // Let the stopped run finish first: its last save would otherwise bring the chat back.
  await whenIdle(chat.id, 15_000);
  await Promise.all(chat.memberIds.map((m) => closeSession(`${chat.id}_${m}`)));
  await stopVm(chat.id);
  deleteChat(chat.id);
  return new Response(null, { status: 204 });
}
