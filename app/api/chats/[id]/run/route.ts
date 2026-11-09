import { guard } from "@/lib/guard";
import type { Effort } from "@/lib/types";
import { eventStream, startRun, stopRun } from "@/lib/runner";
import { getChat } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Start a run: {text} sends a message, {decisions: {callId: true|false}, alwaysEdit?} answers an approval. Streams events. */
export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!getChat(id)) return Response.json({ error: "Chat not found." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { text?: unknown; decisions?: unknown; alwaysEdit?: unknown; effort?: unknown; deep?: unknown } | null;
  let input: { text?: string; decisions?: Record<string, boolean>; alwaysEdit?: boolean; effort?: Effort; deep?: boolean };
  if (typeof body?.text === "string" && body.text.trim()) {
    if (body.text.length > 20_000) return Response.json({ error: "Message is too long." }, { status: 400 });
    const effort = ["auto", "low", "medium", "high", "max"].includes(String(body.effort)) ? (body.effort as Effort) : undefined;
    input = { text: body.text.trim(), effort, deep: body.deep === true };
  } else if (body?.decisions && typeof body.decisions === "object") {
    const decisions: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(body.decisions as Record<string, unknown>)) if (typeof v === "boolean") decisions[k] = v;
    input = { decisions, alwaysEdit: body.alwaysEdit === true };
  } else {
    return Response.json({ error: "Send {text} or {decisions}." }, { status: 400 });
  }

  if (!startRun(id, input)) return Response.json({ error: "The bots are still working on the last message." }, { status: 409 });
  return eventStream(id, req);
}

/** Re-attach to a run that is already going (after a reload or switching chats). */
export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  return eventStream((await params).id, req);
}

/** Stop the bots. */
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  stopRun((await params).id);
  return new Response(null, { status: 204 });
}
