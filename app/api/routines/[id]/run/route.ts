import { guard } from "@/lib/guard";
import { getRoutine, viewOf } from "@/lib/routines";
import { runRoutineNow } from "@/lib/routines-scheduler";
import { ID_RE } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Run now. 409 while it's running or waiting for the user's OK in its chat. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!ID_RE.test(id) || !getRoutine(id)) return Response.json({ error: "Routine not found." }, { status: 404 });
  const res = runRoutineNow(id);
  if (res === "busy") return Response.json({ error: "busy" }, { status: 409 });
  if (res === "waiting") return Response.json({ error: "waiting" }, { status: 409 });
  if (res === "bot") return Response.json({ error: "bot" }, { status: 409 });
  if (res === "missing") return Response.json({ error: "Routine not found." }, { status: 404 });
  const r = getRoutine(id);
  return Response.json(r ? viewOf(r) : null, { status: 202 });
}
