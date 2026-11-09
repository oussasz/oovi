import { guard } from "@/lib/guard";
import { setConnectorBots } from "@/lib/connectors";
import { removeServer, testServer, updateServer } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Connect now and list the server's tools. */
export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(await testServer((await params).id));
}

/** {enabled?, trusted?, bots?: botIds that may use it} */
export async function PUT(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { enabled?: unknown; trusted?: unknown; bots?: unknown } | null;
  const id = (await params).id;
  if (Array.isArray(body?.bots)) {
    const bots = setConnectorBots(id, body.bots.filter((x): x is string => typeof x === "string"));
    return Response.json({ bots });
  }
  await updateServer(id, {
    enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
    trusted: typeof body?.trusted === "boolean" ? body.trusted : undefined,
  });
  return new Response(null, { status: 204 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  await removeServer((await params).id);
  return new Response(null, { status: 204 });
}
