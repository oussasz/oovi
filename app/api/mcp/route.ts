import { guard } from "@/lib/guard";
import { addServer, publicServers, validateServer } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connected MCP servers (secrets never leave the server; only their names). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(publicServers());
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = validateServer(await req.json().catch(() => null));
  if (typeof s === "string") return Response.json({ error: s }, { status: 400 });
  const server = addServer(s);
  return Response.json({ id: server.id }, { status: 201 });
}
