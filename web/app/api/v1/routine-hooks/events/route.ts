// The app collects the calls to its routines' web addresses: ?hooks=<id,id…>&after=<last id it handled>
// (lib/routine-hooks.ts).
import { apiError, getRequestSession } from "@/lib/api";
import { collectHooks } from "@/lib/routine-hooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  const after = Math.max(0, Math.floor(Number(new URL(req.url).searchParams.get("after")) || 0));
  const hooks = (new URL(req.url).searchParams.get("hooks") ?? "").split(",").filter(Boolean);
  return Response.json({ events: await collectHooks(session.user.id, hooks, after) }, { headers: { "cache-control": "no-store" } });
}
