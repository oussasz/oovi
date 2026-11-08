import { reportCrash } from "@/lib/crash";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The UI (and the desktop shell) report unexpected errors here. */
export async function POST(req: Request) {
  const denied = guard(req, { account: false });
  if (denied) return denied;
  const b = ((await req.json().catch(() => null)) ?? {}) as { message?: unknown; stack?: unknown; context?: unknown; source?: unknown };
  if (typeof b.message !== "string" || !b.message) return Response.json({ error: "message required" }, { status: 400 });
  await reportCrash({
    message: b.message,
    stack: typeof b.stack === "string" ? b.stack : undefined,
    context: typeof b.context === "string" ? b.context : undefined,
    source: b.source === "main" ? "main" : "ui",
  });
  return new Response(null, { status: 204 });
}
