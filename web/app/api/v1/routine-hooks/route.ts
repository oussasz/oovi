// The app registers (PUT {id, secret}) or removes (DELETE ?id=) the web address of a routine that starts
// when it is called (lib/routine-hooks.ts).
import { apiError, getRequestSession } from "@/lib/api";
import { deleteHook, ID_RE, registerHook, SECRET_RE } from "@/lib/routine-hooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  const b = (await req.json().catch(() => null)) as { id?: unknown; secret?: unknown } | null;
  const id = typeof b?.id === "string" ? b.id : "";
  const secret = typeof b?.secret === "string" ? b.secret : "";
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return apiError("Bad hook.", 400);
  const r = await registerHook(session.user.id, id, secret);
  if (r === "taken") return apiError("That address is taken.", 409);
  if (r === "full") return apiError("Too many web addresses: remove one you don't use.", 409);
  return new Response(null, { status: 204 });
}

export async function DELETE(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!ID_RE.test(id)) return apiError("Bad hook.", 400);
  await deleteHook(session.user.id, id);
  return new Response(null, { status: 204 });
}
