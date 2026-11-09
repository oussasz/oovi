import { guard } from "@/lib/guard";
import { connectorBots, turnOnForMain } from "@/lib/connectors";
import { addServer, publicServers, validateServer } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connected MCP servers (secrets never leave the server; only their names), with the bots that have each one on. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(publicServers().map((s) => ({ ...s, bots: connectorBots(s.id) })));
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = validateServer(await req.json().catch(() => null));
  if (typeof s === "string") return Response.json({ error: s }, { status: 400 });
  const server = addServer(s);
  // On for the main bot right away, so asking the Chief works without another step.
  const mainName = turnOnForMain(server.id);
  return Response.json({ id: server.id, mainName }, { status: 201 });
}
