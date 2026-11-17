import { guard } from "@/lib/guard";
import { syncHook } from "@/lib/routine-hooks";
import { createRoutine, deleteRoutine, getRoutine, listRoutines, validateRoutine, viewOf } from "@/lib/routines";
import { MAX_ROUTINES } from "@/lib/routines-schedule";
import { telegramConnected } from "@/lib/telegram";
import { readBody } from "./body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All routines, plus whether Telegram is paired (for "Send results to Telegram"). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ routines: listRoutines().map(viewOf), telegram: telegramConnected(), max: MAX_ROUTINES });
}

/** Create a routine: {name, botId, prompt, schedule, timezone, enabled?, notifyTelegram?}. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const input = validateRoutine(body);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const r = createRoutine(input);
  if (typeof r === "string") return Response.json({ error: r }, { status: 409 });
  // A routine started by a web address gets its address now (registered on the oovi website).
  const hookErr = await syncHook(r.id);
  if (hookErr) {
    deleteRoutine(r.id);
    return Response.json({ error: hookErr }, { status: 502 });
  }
  return Response.json(viewOf(getRoutine(r.id) ?? r), { status: 201 });
}
