// Saved logins (lib/logins.ts): GET lists them without passwords, POST adds one, DELETE ?id= removes one.
import { guard } from "@/lib/guard";
import { addLogin, deleteLogin, listLogins } from "@/lib/logins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ logins: listLogins() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const r = addLogin(b ?? {});
  if (typeof r === "string") return Response.json({ error: r }, { status: 400 });
  return Response.json(r, { status: 201 });
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return deleteLogin(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found." }, { status: 404 });
}
