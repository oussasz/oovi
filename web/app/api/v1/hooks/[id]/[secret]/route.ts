// A routine's web address (lib/routine-hooks.ts): POST (any body, 64 KB at most) or GET (the query string
// is the body). 202 when kept for the user's oovi; 404 for an unknown address or a wrong secret.
import { ID_RE, MAX_BODY, receiveHook, SECRET_RE } from "@/lib/routine-hooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; secret: string }> };

async function handle(id: string, secret: string, body: string, contentType: string | null) {
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return new Response("Not found", { status: 404 });
  if (body.length > MAX_BODY) return new Response("Too big (64 KB at most)", { status: 413 });
  try {
    const r = await receiveHook(id, secret, body, contentType);
    if (r === "missing") return new Response("Not found", { status: 404 });
    if (r === "busy") return new Response("Too many calls: try again later", { status: 429 });
    return Response.json({ ok: true, note: "Received: the routine runs when the user's oovi is open." }, { status: 202 });
  } catch (err) {
    console.error("routine hook failed", err instanceof Error ? err.message : err);
    return new Response(null, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id, secret } = await ctx.params;
  return handle(id, secret, await req.text(), req.headers.get("content-type"));
}

export async function GET(req: Request, ctx: Ctx) {
  const { id, secret } = await ctx.params;
  const q = new URL(req.url).searchParams;
  return handle(id, secret, JSON.stringify(Object.fromEntries(q.entries())), "application/json");
}
