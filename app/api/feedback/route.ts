import { CloudError, cloud } from "@/lib/account";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends a problem report or an idea to the oovi team (shown in the admin console).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  let body: { kind?: unknown; message?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const kind = body.kind === "problem" || body.kind === "improvement" || body.kind === "other" ? body.kind : null;
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 5000) : "";
  if (!kind || message.length < 5) return Response.json({ error: "Pick a type and write a few words." }, { status: 400 });
  try {
    await cloud("/api/v1/feedback", { method: "POST", auth: true, body: { kind, message } });
    return Response.json({ ok: true });
  } catch (e) {
    const status = e instanceof CloudError ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status: status === 0 ? 503 : status });
  }
}
