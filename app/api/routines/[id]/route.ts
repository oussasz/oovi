import { guard } from "@/lib/guard";
import { deleteRoutine, getRoutine, updateRoutine, validateRoutine, viewOf } from "@/lib/routines";
import { ID_RE } from "@/lib/store";
import { readBody } from "../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function find(ctx: Ctx) {
  const { id } = await ctx.params;
  return ID_RE.test(id) ? getRoutine(id) : undefined;
}

/** Change a routine. Fields left out keep their value (e.g. {enabled: false} pauses it). */
async function update(req: Request, ctx: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const cur = await find(ctx);
  if (!cur) return Response.json({ error: "Routine not found." }, { status: 404 });
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const input = validateRoutine(body, cur);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const r = updateRoutine(cur.id, input);
  if (!r) return Response.json({ error: "Routine not found." }, { status: 404 });
  return Response.json(viewOf(r));
}

export const PATCH = update;
export const PUT = update;

/** Delete a routine and its chat (a run still going is stopped). */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const cur = await find(ctx);
  if (!cur) return Response.json({ error: "Routine not found." }, { status: 404 });
  deleteRoutine(cur.id);
  return new Response(null, { status: 204 });
}
